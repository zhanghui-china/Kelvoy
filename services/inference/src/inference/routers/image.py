"""Generate a keyframe from persona and landmark references."""

import httpx
from fastapi import APIRouter, HTTPException, Request

from inference.backends import resolve_comfyui_url
from inference.comfyui import ComfyUIError
from inference.comfyui import generate as generate_comfyui
from inference.config import Settings
from inference.disconnect import run_while_connected
from inference.image_rewrite import RewriteRequest, checked_metadata, rewrite
from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
async def generate(request: InferenceRequest, http_request: Request) -> InferenceResponse:
    if request.count not in (None, 1):
        raise HTTPException(status_code=422, detail="image generates one candidate per request")
    if request.size not in (None, "9:16", "16:9", "768x1376", "1376x768"):
        raise HTTPException(status_code=422, detail="image supports 9:16 and 16:9 presets only")
    settings = Settings()
    try:
        return await run_while_connected(http_request, generate_comfyui(
            "image",
            request.prompt,
            request.refs,
            settings.projects_root,
            resolve_comfyui_url(request.comfyui_base_url, settings),
            seed=request.seed,
            expected_ref_hashes=request.expected_ref_hashes,
            aspect="16:9" if request.size in ("16:9", "1376x768") else "9:16",
        ))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ComfyUIError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


@router.get("/rewrite/metadata/")
def rewrite_metadata() -> dict:
    return checked_metadata()


@router.post("/rewrite/")
async def rewrite_prompt(request: RewriteRequest, http_request: Request) -> dict:
    try:
        return await run_while_connected(http_request, rewrite(request, Settings()))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="image prompt rewrite timed out") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="image prompt rewrite backend failed") from exc
    except ValueError as exc:
        status = 422 if "reference" in str(exc) or "pinned" in str(exc) else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc
