"""放大/修复 (PRD §7): Real-ESRGAN-style super-resolution + RIFE
interpolation, required after grid-mode keyframe cropping. Not implemented
at skeleton stage.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/")
def generate() -> None:
    raise HTTPException(status_code=501, detail="not implemented")
