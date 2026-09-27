"""Malformed ComfyUI JSON must fail promptly and cancel submitted work."""

import asyncio
import json

import httpx
import pytest

from inference.comfyui import ComfyUIError, generate


@pytest.mark.parametrize("history", [
    [], None, "unexpected", {"p1": []}, {"p1": {"status": []}},
    {"p1": {"outputs": []}}, {"p1": {"outputs": {"40": []}}},
    {"p1": {"outputs": {"40": {"gifs": "invalid"}}}},
])
def test_invalid_history_returns_502_and_cancels_prompt(tmp_path, history):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(200, content=json.dumps(history))
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy",
                           client=client, timeout_s=0.05)

    with pytest.raises(ComfyUIError) as failure:
        asyncio.run(run())
    assert failure.value.status == 502
    assert calls[-1] == "/api/jobs/p1/cancel"


@pytest.mark.parametrize("upload", [[], None, {"name": 42}, {"name": ""}, {"name": "a.png", "subfolder": []}])
def test_invalid_upload_cannot_submit_a_prompt(tmp_path, upload):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, content=json.dumps(upload))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                     base_url="http://comfy") as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy",
                           client=client, timeout_s=0.05)

    with pytest.raises(ComfyUIError) as failure:
        asyncio.run(run())
    assert failure.value.status == 502
    assert calls == ["/upload/image"]
