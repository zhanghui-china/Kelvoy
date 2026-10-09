"""Generate a clip from a reviewed keyframe or person and scene references."""

from fastapi import APIRouter, HTTPException, Request

from inference.backends import resolve_comfyui_url
from inference.comfyui import ComfyUIError
from inference.comfyui import generate as generate_comfyui
from inference.config import Settings
from inference.disconnect import run_while_connected
from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
async def generate(request: InferenceRequest, http_request: Request) -> InferenceResponse:
    if request.count not in (None, 1):
        raise HTTPException(status_code=422, detail="video generates one clip per request")
    if request.size not in (None, "9:16", "16:9", "480x864", "864x480"):
        raise HTTPException(status_code=422, detail="video supports 9:16 and 16:9 presets only")
    if len(request.refs) not in (1, 2):
        raise HTTPException(status_code=422, detail="video needs one keyframe or two references")
    settings = Settings()
    try:
        return await run_while_connected(http_request, generate_comfyui(
            "video_reference" if len(request.refs) == 2 else "video",
            request.prompt,
            request.refs,
            settings.projects_root,
            resolve_comfyui_url(request.comfyui_base_url, settings),
            seed=request.seed,
            duration_s=request.params.get("duration_s", 5),
            aspect="16:9" if request.size in ("16:9", "864x480") else "9:16",
        ))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ComfyUIError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
