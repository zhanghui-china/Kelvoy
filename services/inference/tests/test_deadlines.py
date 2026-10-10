"""Production deadlines and bounded targeted cancellation, without GPU work."""

import asyncio

import httpx
import pytest

from inference import comfyui
from inference.schemas import InferenceResponse


@pytest.mark.parametrize(
    "kind,expected", [("image", 240), ("video", 900), ("video_reference", 900)]
)
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
    assert comfyui.CANCEL_TIMEOUT_S < 60


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
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await asyncio.wait_for(
                comfyui.generate(
                    "video",
                    "scene",
                    ["first.png"],
                    tmp_path,
                    "http://comfy",
                    client=client,
                ),
                timeout=0.2,
            )

    with pytest.raises(comfyui.ComfyUIError, match="generation failed") as failure:
        asyncio.run(run())
    assert failure.value.status == 502
    assert calls[-1] == "/api/jobs/p1/cancel"
    assert "cancellation failed" in caplog.text


@pytest.mark.parametrize(
    "refs,kind", [(["frame.png"], "video"), (["person.png", "scene.png"], "video_reference")]
)
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
    response = TestClient(app).post(
        "/video/", json={"prompt": "scene", "refs": refs, "size": "16:9"}
    )
    assert response.status_code == 200
    assert seen == [kind]


def test_video_budget_configuration(monkeypatch):
    from pydantic import ValidationError

    from inference.config import Settings

    monkeypatch.setenv("KELVOY_VIDEO_TIMEOUT_SECONDS", "1200")
    assert Settings().video_timeout_seconds == 1200
    for value in ("29", "1801", "nope"):
        monkeypatch.setenv("KELVOY_VIDEO_TIMEOUT_SECONDS", value)
        with pytest.raises(ValidationError):
            Settings()


def test_video_failure_returns_safe_structured_diagnostic(monkeypatch):
    from fastapi.testclient import TestClient

    from inference.app import app

    async def failed(*args, **kwargs):
        raise comfyui.ComfyUIError(
            504,
            "secret prompt /private/path",
            {
                "stage": "comfyui_wait",
                "code": "generation_timeout",
                "message": "视频生成超过 15 分钟，已停止。",
                "elapsed_seconds": 900,
                "budget_seconds": 900,
                "cancellation": "confirmed",
            },
        )

    monkeypatch.setattr("inference.routers.video.generate_comfyui", failed)
    response = TestClient(app).post("/video/", json={"prompt": "scene", "refs": ["a.png"]})
    assert response.status_code == 504
    assert response.json()["detail"]["code"] == "generation_timeout"
    assert "secret" not in response.text


def test_timeout_reports_targeted_cancellation(monkeypatch, tmp_path):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    async def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "own-job"})
        if request.url.path == "/history/own-job":
            return httpx.Response(200, json={})
        if request.url.path == "/api/jobs/own-job/cancel":
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await comfyui.generate(
                "video",
                "private prompt",
                ["first.png"],
                tmp_path,
                "http://comfy",
                client=client,
                timeout_s=0.02,
            )

    with pytest.raises(comfyui.ComfyUIError) as failure:
        asyncio.run(run())
    assert failure.value.detail["code"] == "generation_timeout"
    assert failure.value.detail["stage"] == "comfyui_wait"
    assert failure.value.detail["cancellation"] == "confirmed"
    assert calls[-1] == "/api/jobs/own-job/cancel"
    assert not any(path in ("/interrupt", "/queue") for path in calls)


def test_timeout_does_not_claim_stop_when_cancellation_failed():
    import time

    detail = comfyui.failure_detail(
        504, {"stage": "comfyui_wait", "cancellation": "failed"}, time.monotonic(), 900
    )
    assert "已停止" not in detail["message"]
    assert "未确认" in detail["message"]


def test_phase_log_measures_only_current_phase(monkeypatch, caplog):
    import json
    import logging

    monkeypatch.setattr(comfyui.time, "monotonic", lambda: 100)
    with caplog.at_level(logging.INFO, logger="inference.comfyui"):
        comfyui.log_phase({"stage": "media_validation", "phase_started": 97}, 10)
    event = json.loads(caplog.records[-1].getMessage().split("generation_phase ", 1)[1])
    assert event["elapsed_seconds"] == 3
    detail = comfyui.failure_detail(
        502, {"stage": "media_validation", "cancellation": "confirmed"}, 10, 900
    )
    assert detail["elapsed_seconds"] == 90
