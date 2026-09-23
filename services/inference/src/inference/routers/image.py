"""关键帧 (PRD §7): text + persona ref + landmark ref -> image 9:16, via
Qwen-Image/FLUX.1/HunyuanImage. Also hosts 角色一致性's image side (PuLID/
InstantID-style adapters). Not implemented at skeleton stage —
request/response shapes are real (M1-8), the generation logic isn't.
"""

from fastapi import APIRouter, HTTPException

from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
def generate(request: InferenceRequest) -> InferenceResponse:
    raise HTTPException(status_code=501, detail="not implemented")
