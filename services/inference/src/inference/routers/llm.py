"""脚本/分镜 (PRD §7): brief + destination pack -> shots JSON, via vLLM.
Also hosts 角色一致性's text side. Not implemented at skeleton stage —
request/response shapes are real (M1-8), the generation logic isn't.
"""

from fastapi import APIRouter, HTTPException

from inference.schemas import InferenceRequest, InferenceResponse

router = APIRouter()


@router.post("/", response_model=InferenceResponse)
def generate(request: InferenceRequest) -> InferenceResponse:
    raise HTTPException(status_code=501, detail="not implemented")
