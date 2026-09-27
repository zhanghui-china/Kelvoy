"""Narrow ComfyUI adapter for Kelvoy's image and video workflows."""

import asyncio
import hashlib
import json
import logging
import random
import time
import uuid
from copy import deepcopy
from pathlib import Path

import httpx
from PIL import Image

from inference.schemas import InferenceResponse

BRIDGE = Path(__file__).resolve().parents[4] / "comfyui-bridge"
TEMPLATES = {
    "image": ("1_2_DualRef2IMG_QwenImage2_1_api.json", "482", "images", ".png"),
    "image_single": ("1_1_SingleRef2IMG_QwenImage2_1_api.json", "482", "images", ".png"),
    "video": ("2_0_Image2Video_MinimaxH3_api.json", "40", "gifs", ".mp4"),
    "video_reference": ("2_2_DualRef2Video_MinimaxH3_api.json", "40", "gifs", ".mp4"),
}
MAX_MEDIA_BYTES = 512 * 1024 * 1024
# Keep generation + bounded cleanup below the Worker's 300 second HTTP deadline.
# One measured dual-reference landscape clip took 256.2 s; load can still exceed this budget.
CANCEL_TIMEOUT_S = 10
DIRECT_VIDEO_TIMEOUT_S = 270
DEFAULT_TIMEOUT_S = 240
logger = logging.getLogger(__name__)


class ComfyUIError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


def response_object(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("expected a ComfyUI JSON object")
    return value


def response_string(value: object, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError("expected a ComfyUI string")
    return value


async def validate_media(path: Path, kind: str) -> None:
    if kind == "image":
        def verify_image() -> None:
            with Image.open(path) as image:
                if image.format != "PNG" or image.width <= 0 or image.height <= 0:
                    raise ComfyUIError(502, "ComfyUI returned invalid image media")
                image.verify()

        try:
            await asyncio.to_thread(verify_image)
        except (OSError, ValueError) as exc:
            raise ComfyUIError(502, "ComfyUI returned corrupt image media") from exc
        return

    process = await asyncio.create_subprocess_exec(
        "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:v:0", "-f", "null", "-",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await process.communicate()
    except asyncio.CancelledError:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode != 0:
        diagnostic = stderr.decode(errors="replace")[-500:]
        logger.warning("ComfyUI video validation failed: %s", diagnostic)
        raise ComfyUIError(502, "ComfyUI returned corrupt video media")


async def cancel_prompt(client: httpx.AsyncClient, prompt_id: str) -> None:
    try:
        async with asyncio.timeout(CANCEL_TIMEOUT_S):
            response = await client.post(f"/api/jobs/{prompt_id}/cancel")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("cancelled") is not True:
                logger.warning("ComfyUI did not confirm cancellation for prompt %s", prompt_id)
    except (httpx.HTTPError, ValueError, TimeoutError) as error:
        logger.warning("ComfyUI cancellation failed for prompt %s: %s", prompt_id, error)


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


def build_image_workflow(
    template: dict, uploaded_refs: list[str], prompt: str, seed: int, aspect: str = "9:16"
) -> dict:
    if len(uploaded_refs) not in (1, 2):
        raise ValueError("image workflow needs persona and optional landmark image")
    workflow = deepcopy(template)
    workflow["489"]["inputs"]["image"] = uploaded_refs[0]
    if len(uploaded_refs) == 2:
        workflow["491"]["inputs"]["image"] = uploaded_refs[1]
    workflow["469"]["inputs"]["prompt"] = prompt
    resolution_node = "493" if len(uploaded_refs) == 2 else "491"
    aspect_options = {
        "9:16": "9:16 (Portrait Widescreen)",
        "16:9": "16:9 (Widescreen)",
    }
    if aspect not in aspect_options:
        raise ValueError("unsupported image aspect")
    workflow[resolution_node]["inputs"]["aspect_ratio"] = aspect_options[aspect]
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


def build_dual_ref_video_workflow(
    template: dict, uploaded_refs: list[str], prompt: str, duration_s: int,
    seed: int, aspect: str,
) -> dict:
    if len(uploaded_refs) != 2:
        raise ValueError("direct video needs person and scene images")
    if duration_s not in (3, 4, 5):
        raise ValueError("video duration must be 3 to 5 seconds")
    aspects = {"9:16": "9:16 (Portrait Widescreen)", "16:9": "16:9 (Widescreen)"}
    if aspect not in aspects:
        raise ValueError("unsupported video aspect")
    workflow = deepcopy(template)
    workflow["7"]["inputs"]["image"] = uploaded_refs[0]
    workflow["92"]["inputs"]["image"] = uploaded_refs[1]
    workflow["77"]["inputs"]["prompt"] = prompt
    workflow["76"]["inputs"]["value"] = duration_s
    workflow["82"]["inputs"]["aspect_ratio"] = aspects[aspect]
    workflow["82"]["inputs"]["megapixels"] = 0.9
    workflow["49"]["inputs"]["seed"] = seed
    workflow["49"]["inputs"]["control_after_generate"] = "fixed"
    return workflow


async def _generate_once(
    kind: str,
    prompt: str,
    refs: list[str],
    projects_root: Path,
    base_url: str,
    seed: int | None = None,
    duration_s: int = 5,
    client: httpx.AsyncClient | None = None,
    aspect: str = "9:16",
) -> InferenceResponse:
    if kind not in ("image", "video", "video_reference"):
        raise ValueError("unsupported workflow")
    expected_counts = {"image": (1, 2), "video": (1,), "video_reference": (2,)}
    if len(refs) not in expected_counts[kind]:
        raise ValueError(
            "image needs persona and optional landmark; video needs its required references"
        )
    if not prompt.strip():
        raise ValueError("prompt is required")
    if kind in ("video", "video_reference") and duration_s not in (3, 4, 5):
        raise ValueError("video duration must be 3 to 5 seconds")
    if aspect not in ("9:16", "16:9"):
        raise ValueError("unsupported aspect")
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
            item = response_object(response.json())
            name = response_string(item.get("name"))
            subfolder = response_string(item.get("subfolder", ""), allow_empty=True)
            uploaded.append(f"{subfolder}/{name}" if subfolder else name)
        if kind == "image":
            workflow = build_image_workflow(template, uploaded, prompt, chosen_seed, aspect)
        elif kind == "video_reference":
            workflow = build_dual_ref_video_workflow(
                template, uploaded, prompt, duration_s, chosen_seed, aspect
            )
        else:
            workflow = build_video_workflow(
                template, uploaded[0], prompt, duration_s, chosen_seed
            )
        response = await client.post(
            "/prompt", json={"prompt": workflow, "client_id": str(uuid.uuid4())}
        )
        response.raise_for_status()
        prompt_id = response_string(response_object(response.json()).get("prompt_id"))
        while True:
            response = await client.get(f"/history/{prompt_id}")
            response.raise_for_status()
            histories = response_object(response.json())
            if prompt_id in histories:
                history = response_object(histories[prompt_id])
                status = response_object(history.get("status", {}))
                if status.get("status_str") == "error":
                    raise ComfyUIError(
                        502, f"ComfyUI generation failed: {status.get('messages', [])}"
                    )
                outputs = response_object(
                    response_object(history.get("outputs", {})).get(output_node, {})
                )
                entries = outputs.get(output_key, [])
                if not isinstance(entries, list):
                    raise ValueError("expected a ComfyUI media list")
                if entries:
                    item = response_object(entries[0])
                    filename = response_string(item.get("filename"))
                    subfolder = response_string(item.get("subfolder", ""), allow_empty=True)
                    media_type = response_string(item.get("type", "output"))
                    if not filename.lower().endswith(extension):
                        raise ComfyUIError(502, "ComfyUI returned an unexpected media type")
                    media_kind = "image" if kind == "image" else "video"
                    output_dir = projects_root.resolve() / "inference" / media_kind
                    output_dir.mkdir(parents=True, exist_ok=True)
                    relative = Path("inference") / media_kind / f"{uuid.uuid4().hex}{extension}"
                    target = projects_root.resolve() / relative
                    temporary = target.with_name(f"{target.name}.tmp-{uuid.uuid4().hex}")
                    try:
                        async with client.stream(
                            "GET",
                            "/view",
                            params={
                                "filename": filename,
                                "subfolder": subfolder,
                                "type": media_type,
                            },
                        ) as media:
                            media.raise_for_status()
                            length = media.headers.get("content-length")
                            if length and int(length) > MAX_MEDIA_BYTES:
                                raise ComfyUIError(502, "ComfyUI media exceeds size limit")
                            size = 0
                            with temporary.open("wb") as output:
                                async for chunk in media.aiter_bytes():
                                    size += len(chunk)
                                    if size > MAX_MEDIA_BYTES:
                                        raise ComfyUIError(502, "ComfyUI media exceeds size limit")
                                    output.write(chunk)
                            if size == 0:
                                raise ComfyUIError(502, "ComfyUI returned an empty file")
                        await validate_media(temporary, media_kind)
                        temporary.replace(target)
                    finally:
                        temporary.unlink(missing_ok=True)
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
    except (ComfyUIError, asyncio.CancelledError):
        if prompt_id:
            await cancel_prompt(client, prompt_id)
        raise
    except httpx.HTTPError as exc:
        if prompt_id:
            await cancel_prompt(client, prompt_id)
        status = (
            502
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500
            else 503
        )
        raise ComfyUIError(status, f"ComfyUI request failed: {exc}") from exc
    except (OSError, ValueError, KeyError, TypeError) as exc:
        if prompt_id:
            await cancel_prompt(client, prompt_id)
        raise ComfyUIError(502, f"Invalid ComfyUI response or media: {type(exc).__name__}") from exc
    finally:
        if own_client:
            await client.aclose()


async def generate(
    kind: str,
    prompt: str,
    refs: list[str],
    projects_root: Path,
    base_url: str,
    seed: int | None = None,
    duration_s: int = 5,
    timeout_s: float | None = None,
    client: httpx.AsyncClient | None = None,
    aspect: str = "9:16",
) -> InferenceResponse:
    """Enforce one generation deadline, followed by bounded targeted cancellation."""
    if timeout_s is None:
        timeout_s = DIRECT_VIDEO_TIMEOUT_S if kind == "video_reference" else DEFAULT_TIMEOUT_S
    try:
        return await asyncio.wait_for(
            _generate_once(kind, prompt, refs, projects_root, base_url, seed, duration_s,
                           client, aspect),
            timeout=timeout_s,
        )
    except TimeoutError as exc:
        raise ComfyUIError(504, "ComfyUI generation timed out") from exc
