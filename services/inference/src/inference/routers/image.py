"""Generate a keyframe from persona and landmark references."""

from fastapi import APIRouter, HTTPException

from inference.comfyui import ComfyUIError
from inference.comfyui import generate as generate_comfyui
from inference.config import Settings
from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
async def generate(request: InferenceRequest) -> InferenceResponse:
    if request.count not in (None, 1):
        raise HTTPException(status_code=422, detail="image generates one candidate per request")
    if request.size not in (None, "9:16", "16:9", "768x1376", "1376x768"):
        raise HTTPException(status_code=422, detail="image supports 9:16 and 16:9 presets only")
    settings = Settings()
    try:
        return await generate_comfyui(
            "image",
            request.prompt,
            request.refs,
            settings.projects_root,
            settings.comfyui_base_url,
            seed=request.seed,
            aspect="16:9" if request.size in ("16:9", "1376x768") else "9:16",
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ComfyUIError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
