#!/usr/bin/env python3
"""Local evaluation-only OpenAI adapter for the fixed official Transformers runner.

Each request owns a child process: cancellation/disconnect terminates all GPU work.
Only the parsed answer crosses stdout; thinking never leaves child memory.
"""

import asyncio
import base64
import io
import json
import os
import signal
import sys
from pathlib import Path

import anyio

ROOT = Path(os.environ.get("QWEN_ROOT", "/home1/huntun/kelvoy-qwen-pe"))
MODEL_NAME = "Qwen/Qwen-Image-2.1-PE-I2I"


def child():
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor

    sys.path.insert(0, str(ROOT / "official"))
    import pe_core as core
    import run_transformers as official

    body = json.load(sys.stdin)
    messages = body["messages"]
    system = messages[0]["content"][0]["text"]
    contents = messages[1]["content"]
    images = [
        core.load_image(
            io.BytesIO(
                base64.b64decode(
                    entry["image_url"]["url"].split(",", 1)[1], validate=True
                )
            ),
            core.PROFILES["edit"].image_max_pixels,
        )
        for entry in contents
        if entry["type"] == "image_url"
    ]
    prompt = "\n".join(entry["text"] for entry in contents if entry["type"] == "text")
    model_path = str(ROOT / "model")
    processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
    model = (
        AutoModelForImageTextToText.from_pretrained(
            model_path,
            dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
            local_files_only=True,
        )
        .to("cuda")
        .eval()
    )
    _, answer = official.rewrite(
        model,
        processor,
        core.build_messages(system, prompt, images),
        max_new_tokens=24000,
        temperature=1.0,
        top_p=0.95,
        top_k=20,
        presence_penalty=0.0,
        seed=42,
    )
    if not answer.strip():
        raise ValueError("Official runner produced no answer")
    # The official helper separates thinking. No raw generation is logged/persisted.
    sys.stdout.write(json.dumps({"answer": answer}) + "\n")
    sys.stdout.flush()


if "--child" in sys.argv:
    child()
    raise SystemExit(0)

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

app = FastAPI()
LOCK = asyncio.Lock()


@app.get("/health")
async def health():
    return {"status": "ok", "backend": "official-transformers", "evaluation_only": True}


def validate(body):
    expected = {
        "temperature": 1.0,
        "top_p": 0.95,
        "top_k": 20,
        "min_p": 0.0,
        "presence_penalty": 0.0,
        "max_tokens": 24000,
        "seed": 42,
    }
    if (
        body.get("model") != MODEL_NAME
        or body.get("stream") is not True
        or body.get("chat_template_kwargs") != {"enable_thinking": True}
        or any(body.get(key) != value for key, value in expected.items())
    ):
        raise ValueError("Request differs from official edit sampling contract")
    messages = body["messages"]
    if len(messages) != 2 or [m["role"] for m in messages] != ["system", "user"]:
        raise ValueError("Expected official two-turn message contract")
    if messages[0]["content"] != [
        {"type": "text", "text": (ROOT / "model/system_prompt.txt").read_text().strip()}
    ]:
        raise ValueError("System prompt differs from pinned checkpoint")
    content = messages[1]["content"]
    kinds = [entry["type"] for entry in content]
    if kinds not in [["image_url", "text"], ["image_url", "image_url", "text"]]:
        raise ValueError("Expected one or two ordered images followed by text")
    for entry in content[:-1]:
        url = entry["image_url"]["url"]
        if not url.startswith("data:image/png;base64,") or len(url) > 12_000_000:
            raise ValueError("Only bounded inline PNG reference images are accepted")
    if not isinstance(content[-1]["text"], str) or len(content[-1]["text"]) > 80_000:
        raise ValueError("Invalid bounded user instruction")


async def terminate(process):
    if process.returncode is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(process.wait(), 5)
        except TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()


async def finish_cleanup(process):
    # Shield framework cancel scopes, and also tolerate repeated native Task.cancel
    # calls. Never release the semaphore while the GPU child still exists.
    cancelled = False
    with anyio.CancelScope(shield=True):
        task = asyncio.create_task(terminate(process))
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                cancelled = True
        task.result()
    if cancelled:
        raise asyncio.CancelledError


@app.post("/v1/chat/completions")
async def complete(request: Request):
    try:
        body = await request.json()
        validate(body)
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        raise HTTPException(400, str(exc)) from exc

    async def stream():
        process = None
        owns_lock = False
        try:
            async with asyncio.timeout(900):
                while not owns_lock:
                    if await request.is_disconnected():
                        return
                    try:
                        async with asyncio.timeout(0.25):
                            await LOCK.acquire()
                            owns_lock = True
                    except TimeoutError:
                        yield ": queued\n\n"
                if await request.is_disconnected():
                    return
                if owns_lock:
                    process = await asyncio.create_subprocess_exec(
                        sys.executable,
                        str(Path(__file__).resolve()),
                        "--child",
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL,
                        start_new_session=True,
                        limit=2 * 1024**2,
                    )
                    process.stdin.write(json.dumps(body).encode())
                    await process.stdin.drain()
                    process.stdin.close()
                    read = asyncio.create_task(process.stdout.readline())
                    try:
                        while not read.done():
                            if await request.is_disconnected():
                                return
                            yield ": heartbeat\n\n"
                            await asyncio.sleep(0.25)
                        line = await read
                        status = await process.wait()
                        if status != 0 or not line:
                            raise RuntimeError("Official Transformers rewrite failed")
                        answer = json.loads(line)["answer"]
                        yield (
                            "data: "
                            + json.dumps({"choices": [{"delta": {"content": answer}}]})
                            + "\n\n"
                        )
                        yield "data: [DONE]\n\n"
                    finally:
                        if not read.done():
                            read.cancel()
                            await asyncio.gather(read, return_exceptions=True)
        except (TimeoutError, RuntimeError):
            # Empty/failed answer is rejected by Inference's fail-closed parser.
            yield "data: [DONE]\n\n"
        finally:
            try:
                if process is not None:
                    await finish_cleanup(process)
            finally:
                if owns_lock:
                    LOCK.release()

    return StreamingResponse(stream(), media_type="text/event-stream")
