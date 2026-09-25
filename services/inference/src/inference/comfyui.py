"""Narrow ComfyUI adapter for Kelvoy's image and video workflows."""

import asyncio
import hashlib
import json
import random
import time
import uuid
from copy import deepcopy
from pathlib import Path

import httpx

from inference.schemas import InferenceResponse

BRIDGE = Path(__file__).resolve().parents[4] / "comfyui-bridge"
TEMPLATES = {
    "image": ("1_2_DualRef2IMG_QwenImage2_1_api.json", "482", "images", ".png"),
    "image_single": ("1_1_SingleRef2IMG_QwenImage2_1_api.json", "482", "images", ".png"),
    "video": ("2_0_Image2Video_MinimaxH3_api.json", "40", "gifs", ".mp4"),
}


class ComfyUIError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


def resolve_reference(projects_root: Path, key: str) -> Path:
    relative = Path(key)
    if relative.is_absolute() or ".." in relative.parts or not key.strip():
        raise ValueError("reference key must be relative to projects root")
    if relative.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("reference must be a PNG, JPEG, or WebP image")
    root = projects_root.resolve()
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise ValueError("reference file is missing or outside projects root")
    return candidate


def build_image_workflow(template: dict, uploaded_refs: list[str], prompt: str, seed: int) -> dict:
    if len(uploaded_refs) not in (1, 2):
        raise ValueError("image workflow needs persona and optional landmark image")
    workflow = deepcopy(template)
    workflow["489"]["inputs"]["image"] = uploaded_refs[0]
    if len(uploaded_refs) == 2:
        workflow["491"]["inputs"]["image"] = uploaded_refs[1]
    workflow["469"]["inputs"]["prompt"] = prompt
    resolution_node = "493" if len(uploaded_refs) == 2 else "491"
    workflow[resolution_node]["inputs"]["aspect_ratio"] = "9:16 (Portrait Widescreen)"
    workflow[resolution_node]["inputs"]["megapixels"] = 1.0
    workflow["474"]["inputs"]["seed"] = seed
    workflow["474"]["inputs"]["control_after_generate"] = "fixed"
    return workflow


def build_video_workflow(
    template: dict, uploaded_first_frame: str, prompt: str, duration_s: int, seed: int
) -> dict:
    if duration_s not in (3, 4, 5):
        raise ValueError("video duration must be 3 to 5 seconds")
    workflow = deepcopy(template)
    workflow["7"]["inputs"]["image"] = uploaded_first_frame
    workflow["74"]["inputs"]["prompt"] = prompt
    workflow["71"]["inputs"]["value"] = duration_s
    workflow["9"]["inputs"]["scale_to_length"] = 480
    workflow["9"]["inputs"]["scale_to_side"] = "shortest"
    workflow["49"]["inputs"]["seed"] = seed
    workflow["49"]["inputs"]["control_after_generate"] = "fixed"
    return workflow


async def generate(
    kind: str,
    prompt: str,
    refs: list[str],
    projects_root: Path,
    base_url: str,
    seed: int | None = None,
    duration_s: int = 5,
    timeout_s: float = 240,
    client: httpx.AsyncClient | None = None,
) -> InferenceResponse:
    if kind not in ("image", "video"):
        raise ValueError("unsupported workflow")
    if len(refs) not in ((1, 2) if kind == "image" else (1,)):
        raise ValueError("image needs persona and optional landmark; video needs one first frame")
    if not prompt.strip():
        raise ValueError("prompt is required")
    if kind == "video" and duration_s not in (3, 4, 5):
        raise ValueError("video duration must be 3 to 5 seconds")
    inputs = [resolve_reference(projects_root, key) for key in refs]
    template_kind = "image_single" if kind == "image" and len(refs) == 1 else kind
    filename, output_node, output_key, extension = TEMPLATES[template_kind]
    template_bytes = (BRIDGE / filename).read_bytes()
    template = json.loads(template_bytes)
    chosen_seed = seed if seed is not None else random.SystemRandom().randrange(2**32)
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(base_url=base_url, timeout=30)
    assert client is not None
    prompt_id = None
    started = time.monotonic()
    try:
        uploaded = []
        for source in inputs:
            with source.open("rb") as file:
                response = await client.post(
                    "/upload/image",
                    files={"image": (source.name, file, "application/octet-stream")},
                    data={"overwrite": "false"},
                )
            response.raise_for_status()
            item = response.json()
            uploaded.append(
                f"{item['subfolder']}/{item['name']}" if item.get("subfolder") else item["name"]
            )
        workflow = (
            build_image_workflow(template, uploaded, prompt, chosen_seed)
            if kind == "image"
            else build_video_workflow(template, uploaded[0], prompt, duration_s, chosen_seed)
        )
        response = await client.post(
            "/prompt", json={"prompt": workflow, "client_id": str(uuid.uuid4())}
        )
        response.raise_for_status()
        prompt_id = response.json()["prompt_id"]
        while time.monotonic() - started < timeout_s:
            response = await client.get(f"/history/{prompt_id}")
            response.raise_for_status()
            history = response.json().get(prompt_id)
            if history:
                status = history.get("status", {})
                if status.get("status_str") == "error":
                    raise ComfyUIError(
                        502, f"ComfyUI generation failed: {status.get('messages', [])}"
                    )
                outputs = history.get("outputs", {}).get(output_node, {})
                entries = outputs.get(output_key, [])
                if entries:
                    item = entries[0]
                    if not item["filename"].lower().endswith(extension):
                        raise ComfyUIError(502, "ComfyUI returned an unexpected media type")
                    media = await client.get(
                        "/view",
                        params={
                            "filename": item["filename"],
                            "subfolder": item.get("subfolder", ""),
                            "type": item.get("type", "output"),
                        },
                    )
                    media.raise_for_status()
                    if not media.content:
                        raise ComfyUIError(502, "ComfyUI returned an empty file")
                    output_dir = projects_root.resolve() / "inference" / kind
                    output_dir.mkdir(parents=True, exist_ok=True)
                    relative = Path("inference") / kind / f"{uuid.uuid4().hex}{extension}"
                    (projects_root.resolve() / relative).write_bytes(media.content)
                    return InferenceResponse(
                        paths=[relative.as_posix()],
                        model="Qwen-Image-2.1" if kind == "image" else "MiniMax-H3",
                        version=hashlib.sha256(template_bytes).hexdigest()[:12],
                        seed=chosen_seed,
                        seconds=round(time.monotonic() - started, 2),
                    )
                if status.get("completed"):
                    raise ComfyUIError(502, "ComfyUI finished without expected output")
            await asyncio.sleep(2)
        raise ComfyUIError(504, "ComfyUI generation timed out")
    except (ComfyUIError, asyncio.CancelledError):
        if prompt_id:
            try:
                await client.post(f"/api/jobs/{prompt_id}/cancel")
            except httpx.HTTPError:
                pass
        raise
    except httpx.HTTPError as exc:
        if prompt_id:
            try:
                await client.post(f"/api/jobs/{prompt_id}/cancel")
            except httpx.HTTPError:
                pass
        status = (
            502
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500
            else 503
        )
        raise ComfyUIError(status, f"ComfyUI request failed: {exc}") from exc
    finally:
        if own_client:
            await client.aclose()
