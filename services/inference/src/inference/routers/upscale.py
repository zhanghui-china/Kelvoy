"""放大/修复 (PRD §7): Real-ESRGAN-style super-resolution + RIFE
interpolation, required after grid-mode keyframe cropping. Not implemented
at skeleton stage — request/response shapes are real (M1-8), the
generation logic isn't.
"""

from fastapi import APIRouter, HTTPException

from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
def generate(request: InferenceRequest) -> InferenceResponse:
    raise HTTPException(status_code=501, detail="not implemented")
