"""CPU-only adapter contract/cancellation regressions, with no model imports."""

import asyncio
import importlib.util
import json
import signal
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "qwen_adapter", Path(__file__).resolve().parents[3] / "infra/dgx/qwen-pe-transformers.py"
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


@pytest.fixture
def body(tmp_path, monkeypatch):
    monkeypatch.setattr(adapter, "ROOT", tmp_path)
    (tmp_path / "model").mkdir()
    (tmp_path / "model/system_prompt.txt").write_text("official system\n")
    return {
        "model": adapter.MODEL_NAME,
        "stream": True,
        "temperature": 1.0,
        "top_p": 0.95,
        "top_k": 20,
        "min_p": 0,
        "presence_penalty": 0,
        "max_tokens": 24000,
        "seed": 42,
        "chat_template_kwargs": {"enable_thinking": True},
        "messages": [
            {"role": "system", "content": [{"type": "text", "text": "official system"}]},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                    {"type": "text", "text": "Only hands and pastry, 9:16 canvas."},
                ],
            },
        ],
    }


def test_official_sampling_and_order_contract(body):
    adapter.validate(body)
    body["messages"][1]["content"].insert(1, body["messages"][1]["content"][0].copy())
    adapter.validate(body)
    body["messages"][1]["content"].reverse()
    with pytest.raises(ValueError, match="ordered"):
        adapter.validate(body)


@pytest.mark.parametrize(
    "key,value",
    [
        ("temperature", 0.7),
        ("top_k", 50),
        ("presence_penalty", 1.5),
        ("seed", 0),
        ("max_tokens", 100),
        ("chat_template_kwargs", {"enable_thinking": False}),
        ("model", "other-model"),
        ("stream", False),
    ],
)
def test_sampling_mismatch_rejected(body, key, value):
    body[key] = value
    with pytest.raises(ValueError, match="sampling"):
        adapter.validate(body)


class Request:
    def __init__(self, body):
        self.body = body
        self.disconnected = False

    async def json(self):
        return self.body

    async def is_disconnected(self):
        return self.disconnected


def test_close_terminates_process_group_before_unlock(body, monkeypatch):
    async def run():
        adapter.LOCK = asyncio.Lock()
        exits = asyncio.Event()
        signals = []

        class Input:
            def write(self, value):
                assert json.loads(value) == body

            async def drain(self):
                pass

            def close(self):
                pass

        class Process:
            pid = 99999
            returncode = None
            stdin = Input()
            wait_finished = False

            async def readline(self):
                await asyncio.Event().wait()

            async def wait(self):
                await exits.wait()
                self.returncode = -15
                self.wait_finished = True
                assert adapter.LOCK.locked()
                return self.returncode

        process = Process()
        process.stdout = process

        async def spawn(*args, **kwargs):
            assert kwargs["stderr"] == asyncio.subprocess.DEVNULL
            assert kwargs["start_new_session"] is True
            return process

        def kill(pid, value):
            signals.append((pid, value))
            exits.set()

        monkeypatch.setattr(adapter.asyncio, "create_subprocess_exec", spawn)
        monkeypatch.setattr(adapter.os, "killpg", kill)
        request = Request(body)
        response = await adapter.complete(request)
        assert await anext(response.body_iterator) == ": heartbeat\n\n"
        assert adapter.LOCK.locked()
        await response.body_iterator.aclose()
        assert signals == [(process.pid, signal.SIGTERM)]
        assert process.wait_finished
        assert not adapter.LOCK.locked()

    asyncio.run(run())


def test_disconnected_queued_request_never_spawns(body, monkeypatch):
    async def run():
        adapter.LOCK = asyncio.Lock()
        await adapter.LOCK.acquire()

        async def spawn(*args, **kwargs):
            raise AssertionError("Disconnected queued request spawned a model child")

        monkeypatch.setattr(adapter.asyncio, "create_subprocess_exec", spawn)
        request = Request(body)
        response = await adapter.complete(request)
        assert await anext(response.body_iterator) == ": queued\n\n"
        request.disconnected = True
        adapter.LOCK.release()
        with pytest.raises(StopAsyncIteration):
            await anext(response.body_iterator)
        assert not adapter.LOCK.locked()

    asyncio.run(run())


def test_repeated_native_cancellation_waits_for_cleanup(monkeypatch):
    async def run():
        stopped = asyncio.Event()
        finish = asyncio.Event()

        class Process:
            pid = 99999
            returncode = None

            async def wait(self):
                await finish.wait()
                self.returncode = -15
                return -15

        process = Process()
        monkeypatch.setattr(adapter.os, "killpg", lambda *_: stopped.set())
        task = asyncio.create_task(adapter.finish_cleanup(process))
        await stopped.wait()
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert process.returncode == -15

    asyncio.run(run())


def test_anyio_cancel_scope_shields_cleanup(monkeypatch):
    import anyio

    async def run():
        class Process:
            pid = 99999
            returncode = None

            async def wait(self):
                await anyio.sleep(0.01)
                self.returncode = -15
                return -15

        process = Process()
        monkeypatch.setattr(adapter.os, "killpg", lambda *_: None)
        with anyio.CancelScope() as scope:
            scope.cancel()
            await adapter.finish_cleanup(process)
        assert process.returncode == -15

    asyncio.run(run())


def test_cancel_at_lock_acquisition_does_not_leak_lock(body, monkeypatch):
    async def run():
        adapter.LOCK = asyncio.Lock()
        await adapter.LOCK.acquire()

        async def spawn(*args, **kwargs):
            raise AssertionError("Cancelled request spawned a child")

        monkeypatch.setattr(adapter.asyncio, "create_subprocess_exec", spawn)
        response = await adapter.complete(Request(body))
        task = asyncio.create_task(anext(response.body_iterator))
        await asyncio.sleep(0)
        adapter.LOCK.release()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not adapter.LOCK.locked()
        assert not adapter.LOCK._waiters

    asyncio.run(run())
