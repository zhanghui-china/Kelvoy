"""ComfyUI adapter behavior without requiring a GPU."""

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from inference.comfyui import (
    TEMPLATES,
    ComfyUIError,
    build_dual_ref_video_workflow,
    build_image_workflow,
    build_video_workflow,
    generate,
    resolve_reference,
)
from inference.config import Settings

BRIDGE = Path(__file__).resolve().parents[3] / "comfyui-bridge"


@pytest.mark.parametrize("template_kind", TEMPLATES)
def test_production_workflow_graph_is_explicit_and_connected(template_kind):
    filename, output_node, _, _ = TEMPLATES[template_kind]
    workflow = json.loads((BRIDGE / filename).read_text())
    forbidden = {"GetNode", "SetNode", "Anything Everywhere"}
    assert not {node["class_type"] for node in workflow.values()} & forbidden

    reachable = set()

    def visit(node_id):
        if node_id in reachable:
            return
        assert node_id in workflow
        reachable.add(node_id)
        for value in workflow[node_id]["inputs"].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                assert value[0] in workflow
                visit(value[0])

    visit(output_node)
    assert reachable == set(workflow)


def test_dual_reference_video_has_explicit_model_and_clip_inputs():
    template = json.loads((BRIDGE / TEMPLATES["video_reference"][0]).read_text())
    workflow = build_dual_ref_video_workflow(
        template, ["person.png", "scene.jpg"], "walk", 5, 42, "9:16"
    )
    assert workflow["49"]["inputs"]["model"] == ["88", 0]
    assert workflow["77"]["inputs"]["clip"] == ["3", 0]


def test_inference_service_uses_shared_projects_root(monkeypatch, tmp_path):
    monkeypatch.setenv("KELVOY_PROJECTS_ROOT", str(tmp_path))
    monkeypatch.setenv("KELVOY_COMFYUI_BASE_URL", "http://127.0.0.1:8188")
    settings = Settings(_env_file=None)
    assert settings.projects_root == tmp_path
    assert settings.comfyui_base_url == "http://127.0.0.1:8188"


def test_reference_key_must_stay_within_projects_root(tmp_path):
    image = tmp_path / "persona" / "front.png"
    image.parent.mkdir()
    image.write_bytes(b"image")

    assert resolve_reference(tmp_path, "persona/front.png") == image
    with pytest.raises(ValueError, match="reference"):
        resolve_reference(tmp_path, "../outside.png")
    with pytest.raises(ValueError, match="reference"):
        resolve_reference(tmp_path, str(image))
    with pytest.raises(ValueError, match="reference"):
        resolve_reference(tmp_path, "persona/missing.png")
    with pytest.raises(ValueError, match="reference"):
        resolve_reference(tmp_path, "persona/front.txt")


def test_image_workflow_uses_role_then_landmark_and_vertical_format():
    template = json.loads((BRIDGE / "1_2_DualRef2IMG_QwenImage2_1_api.json").read_text())

    workflow = build_image_workflow(
        template, ["role.png", "landmark.jpg"], "traveler at Buddha", 31
    )

    assert workflow["489"]["inputs"]["image"] == "role.png"
    assert workflow["491"]["inputs"]["image"] == "landmark.jpg"
    assert workflow["469"]["inputs"]["prompt"] == "traveler at Buddha"
    assert workflow["493"]["inputs"]["aspect_ratio"] == "9:16 (Portrait Widescreen)"
    assert workflow["474"]["inputs"]["seed"] == 31
    assert template["493"]["inputs"]["aspect_ratio"] == "3:4 (Portrait Standard)"


def test_single_reference_image_workflow_does_not_use_landmark():
    template = json.loads((BRIDGE / "1_1_SingleRef2IMG_QwenImage2_1_api.json").read_text())
    workflow = build_image_workflow(template, ["role.png"], "portrait", 31)
    assert workflow["489"]["inputs"]["image"] == "role.png"
    assert workflow["491"]["class_type"] == "ResolutionSelector"
    assert workflow["491"]["inputs"]["aspect_ratio"] == "9:16 (Portrait Widescreen)"


def test_image_workflow_supports_wide_aspect_without_mutating_template():
    template = json.loads((BRIDGE / "1_1_SingleRef2IMG_QwenImage2_1_api.json").read_text())
    checked_in_wide = json.loads((BRIDGE / "1_9_NonaRef2IMG_QwenImage2_1_api.json").read_text())
    original = template["491"]["inputs"]["aspect_ratio"]
    workflow = build_image_workflow(template, ["role.png"], "wide view", 31, "16:9")
    assert workflow["491"]["inputs"]["aspect_ratio"] == checked_in_wide["501"]["inputs"][
        "aspect_ratio"
    ]
    assert template["491"]["inputs"]["aspect_ratio"] == original


def test_video_workflow_uses_selected_first_frame_and_measured_preset():
    template = json.loads((BRIDGE / "2_0_Image2Video_MinimaxH3_api.json").read_text())

    workflow = build_video_workflow(template, "keyframe.png", "slow pan", 5, 31)

    assert workflow["7"]["inputs"]["image"] == "keyframe.png"
    assert workflow["74"]["inputs"]["prompt"] == "slow pan"
    assert workflow["71"]["inputs"]["value"] == 5
    assert workflow["9"]["inputs"]["scale_to_length"] == 480
    assert workflow["9"]["inputs"]["aspect_ratio"] == "original"
    assert workflow["49"]["inputs"]["seed"] == 31


def test_dual_reference_video_uses_person_and_scene_with_requested_aspect():
    template = json.loads((BRIDGE / "2_2_DualRef2Video_MinimaxH3_api.json").read_text())
    workflow = build_dual_ref_video_workflow(
        template, ["person.png", "scene.jpg"], "traveler walks through scene", 3, 31,
        "9:16",
    )
    assert workflow["7"]["inputs"]["image"] == "person.png"
    assert workflow["92"]["inputs"]["image"] == "scene.jpg"
    assert workflow["77"]["inputs"]["prompt"] == "traveler walks through scene"
    assert workflow["76"]["inputs"]["value"] == 3
    assert workflow["82"]["inputs"]["aspect_ratio"] == "9:16 (Vertical)"
    assert workflow["82"]["inputs"]["megapixels"] == 0.9
    assert workflow["49"]["inputs"]["seed"] == 31
    assert template["76"]["inputs"]["value"] == 15


@pytest.mark.parametrize(
    "kind,node,key,extension",
    [
        ("image", "482", "images", ".png"),
        ("image_single", "482", "images", ".png"),
        ("video", "40", "gifs", ".mp4"),
    ],
)
def test_generate_uploads_submits_and_saves_selected_output(tmp_path, kind, node, key, extension):
    inputs = (
        ["persona.png", "landmark.jpg"]
        if kind == "image"
        else ["persona.png"]
        if kind == "image_single"
        else ["first.png"]
    )
    modality = "image" if kind.startswith("image") else "video"
    for name in inputs:
        (tmp_path / name).write_bytes(b"fixture")
    submitted = []

    def handler(request):
        if request.url.path == "/upload/image":
            assert b"fixture" in request.content
            name = inputs[len(submitted)]
            submitted.append(name)
            return httpx.Response(200, json={"name": name, "subfolder": "", "type": "input"})
        if request.url.path == "/prompt":
            workflow = json.loads(request.content)["prompt"]
            assert workflow["489" if modality == "image" else "7"]["inputs"]["image"] == inputs[0]
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(
                200,
                json={
                    "p1": {
                        "outputs": {
                            node: {
                                key: [
                                    {
                                        "filename": f"result{extension}",
                                        "subfolder": "",
                                        "type": "output",
                                    }
                                ]
                            }
                        },
                        "status": {"completed": True},
                    }
                },
            )
        if request.url.path == "/view":
            assert request.url.params["filename"] == f"result{extension}"
            return httpx.Response(200, content=b"media bytes")
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            return await generate(
                modality, "scene", inputs, tmp_path, "http://comfy", seed=31, client=client
            )

    result = asyncio.run(run())
    assert result.seed == 31
    assert len(submitted) == len(inputs)
    assert result.paths[0].startswith(f"inference/{modality}/")
    assert (tmp_path / result.paths[0]).read_bytes() == b"media bytes"


def test_generate_cancels_failed_prompt_without_touching_other_jobs(tmp_path):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(
                200, json={"p1": {"status": {"status_str": "error", "messages": []}}}
            )
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy", client=client)

    with pytest.raises(ComfyUIError, match="generation failed"):
        asyncio.run(run())
    assert calls[-1] == "/api/jobs/p1/cancel"


def test_http_disconnect_cancels_only_the_submitted_comfyui_prompt(tmp_path):
    from inference.disconnect import run_while_connected

    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(200, json={})
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    class Caller:
        async def is_disconnected(self):
            return "/history/p1" in calls

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await run_while_connected(
                Caller(), generate("video", "scene", ["first.png"], tmp_path,
                                   "http://comfy", client=client)
            )

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run())
    assert calls[-1] == "/api/jobs/p1/cancel"


def test_hard_deadline_includes_reference_upload(tmp_path):
    (tmp_path / "first.png").write_bytes(b"fixture")

    async def handler(request):
        if request.url.path == "/upload/image":
            await asyncio.sleep(1)
            return httpx.Response(200, json={"name": "first.png"})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy",
                           client=client, timeout_s=0.02)

    with pytest.raises(ComfyUIError) as error:
        asyncio.run(run())
    assert error.value.status == 504


def test_hard_deadline_cancels_a_prompt_stuck_in_history_request(tmp_path):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    async def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            await asyncio.sleep(1)
            return httpx.Response(200, json={})
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy",
                           client=client, timeout_s=0.02)

    with pytest.raises(ComfyUIError) as error:
        asyncio.run(run())
    assert error.value.status == 504
    assert calls[-1] == "/api/jobs/p1/cancel"


def test_generate_rejects_oversized_media_and_cleans_temporary_file(tmp_path, monkeypatch):
    from inference import comfyui

    monkeypatch.setattr(comfyui, "MAX_MEDIA_BYTES", 4)
    (tmp_path / "first.png").write_bytes(b"fixture")

    def handler(request):
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(200, json={"p1": {"outputs": {"40": {
                "gifs": [{"filename": "result.mp4"}]
            }}}})
        if request.url.path == "/view":
            return httpx.Response(200, content=b"12345")
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy", client=client)

    with pytest.raises(ComfyUIError, match="size limit"):
        asyncio.run(run())
    assert list((tmp_path / "inference" / "video").glob("*")) == []


def test_bad_comfy_response_still_attempts_cancel_and_returns_server_error(tmp_path):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(200, json={"p1": {"outputs": {"40": {"gifs": [{}]}}}})
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(500, json={"error": "cancel unavailable"})
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy", client=client)

    with pytest.raises(ComfyUIError) as failure:
        asyncio.run(run())
    assert failure.value.status == 502
    assert calls[-1] == "/api/jobs/p1/cancel"


@pytest.mark.parametrize("cancel_response", [None, [], "unexpected"])
def test_non_object_cancel_response_preserves_generation_error(tmp_path, cancel_response):
    (tmp_path / "first.png").write_bytes(b"fixture")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/upload/image":
            return httpx.Response(200, json={"name": "first.png"})
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            return httpx.Response(200, json={"p1": {"status": {"status_str": "error"}}})
        if request.url.path == "/api/jobs/p1/cancel":
            return httpx.Response(200, json=cancel_response)
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://comfy"
        ) as client:
            await generate("video", "scene", ["first.png"], tmp_path, "http://comfy", client=client)

    with pytest.raises(ComfyUIError, match="generation failed"):
        asyncio.run(run())
    assert calls[-1] == "/api/jobs/p1/cancel"
