"""Production deadlines and bounded targeted cancellation, without GPU work."""
import asyncio

import httpx
import pytest

from inference import comfyui
from inference.schemas import InferenceResponse


@pytest.mark.parametrize("kind,expected", [("image", 240), ("video", 240), ("video_reference", 270)])
def test_default_deadline_depends_on_workflow(monkeypatch, tmp_path, kind, expected):
    seen = []

    async def immediate(*args):
        return InferenceResponse(paths=["result"], model="test", version="1", seed=1, seconds=1)

    async def capture(awaitable, timeout):
        seen.append(timeout)
        return await awaitable

    monkeypatch.setattr(comfyui, "_generate_once", immediate)
    monkeypatch.setattr(comfyui.asyncio, "wait_for", capture)
    asyncio.run(comfyui.generate(kind, "scene", [], tmp_path, "http://comfy"))
    assert seen == [expected]
    assert expected + comfyui.CANCEL_TIMEOUT_S <= 280 < 300


def test_stalled_cancel_preserves_original_failure(monkeypatch, tmp_path, caplog):
    (tmp_path / "first.png").write_bytes(b"fixture")
    monkeypatch.setattr(comfyui, "CANCEL_TIMEOUT_S", 0.02, raising=False)
    calls = []

    async def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(200, json={"p1": {"status": {"status_str": "error"}}})
        if request.url.path == "/api/jobs/p1/cancel":
            await asyncio.sleep(2)
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                     base_url="http://comfy") as client:
            await asyncio.wait_for(comfyui.generate(
                "video", "scene", ["first.png"], tmp_path, "http://comfy", client=client,
            ), timeout=0.2)

    with pytest.raises(comfyui.ComfyUIError, match="generation failed") as failure:
        asyncio.run(run())
    assert failure.value.status == 502
    assert calls[-1] == "/api/jobs/p1/cancel"
    assert "cancellation failed" in caplog.text


@pytest.mark.parametrize("refs,kind", [(["frame.png"], "video"), (["person.png", "scene.png"], "video_reference")])
def test_video_endpoint_selects_workflow_before_deadline(monkeypatch, refs, kind):
    from fastapi.testclient import TestClient
    from inference.app import app

    seen = []

    async def capture(*args, **kwargs):
        seen.append(args[0])
        # No route override may accidentally force both paths back to 240 seconds.
        assert "timeout_s" not in kwargs
        return InferenceResponse(paths=["result"], model="test", version="1", seed=1, seconds=1)

    monkeypatch.setattr("inference.routers.video.generate_comfyui", capture)
    response = TestClient(app).post("/video/", json={"prompt": "scene", "refs": refs, "size": "16:9"})
    assert response.status_code == 200
    assert seen == [kind]
