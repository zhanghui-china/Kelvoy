"""图生视频 (PRD §7): image (+prompt) -> video 3-5s, via Wan 2.x (I2V,
VACE) / HunyuanVideo I2V / CogVideoX. Not implemented at skeleton stage —
request/response shapes are real (M1-8), the generation logic isn't.
"""

from fastapi import APIRouter, HTTPException

from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
def generate(request: InferenceRequest) -> InferenceResponse:
    raise HTTPException(status_code=501, detail="not implemented")
