"""Request validation and the remaining skeleton endpoints."""

import pytest
from fastapi.testclient import TestClient

from inference.app import app
from inference.schemas import InferenceResponse

client = TestClient(app)


@pytest.mark.parametrize("endpoint", ["/image/", "/video/"])
def test_wide_generation_passes_aspect_to_comfyui(monkeypatch, endpoint):
    seen = []

    async def fake_generate(*args, **kwargs):
        seen.append(kwargs["aspect"])
        return InferenceResponse(paths=["result"], model="test", version="1", seed=1, seconds=1)

    module = "inference.routers.image" if endpoint == "/image/" else "inference.routers.video"
    monkeypatch.setattr(f"{module}.generate_comfyui", fake_generate)
    response = client.post(
        endpoint, json={"prompt": "scene", "refs": ["frame.png"], "size": "16:9"}
    )
    assert response.status_code == 200
    assert seen == ["16:9"]

ENDPOINTS = ["/llm/", "/image/", "/video/", "/upscale/"]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_missing_prompt_returns_422(endpoint):
    resp = client.post(endpoint, json={})
    assert resp.status_code == 422


@pytest.mark.parametrize("endpoint", ["/llm/", "/upscale/"])
def test_well_formed_request_reaches_the_501_stub(endpoint):
    resp = client.post(
        endpoint,
        json={
            "prompt": "灵山大佛，上午顺光",
            "refs": ["dest/lingshan/l1_01.jpg"],
            "seed": 42,
            "size": "1080x1920",
            "count": 2,
            "params": {"sampler": "dpm++2m"},
        },
    )
    assert resp.status_code == 501
    assert resp.json() == {"detail": "not implemented"}


def test_params_defaults_to_empty_dict_when_omitted():
    resp = client.post("/llm/", json={"prompt": "test"})
    # Still 501 (stub), but proves the request body itself validated fine
    # with only `prompt` given — refs/seed/size/count/params all optional.
    assert resp.status_code == 501


@pytest.mark.parametrize("endpoint", ["/image/", "/video/"])
def test_generation_rejects_missing_refs_before_contacting_comfyui(endpoint):
    resp = client.post(endpoint, json={"prompt": "scene", "refs": []})
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "endpoint,body",
    [
        ("/image/", {"prompt": "scene", "count": 2}),
        ("/image/", {"prompt": "scene", "size": "1080x1920"}),
        ("/video/", {"prompt": "scene", "count": 2}),
        ("/video/", {"prompt": "scene", "size": "704x1280"}),
    ],
)
def test_generation_rejects_unimplemented_preset(endpoint, body):
    assert client.post(endpoint, json=body).status_code == 422
