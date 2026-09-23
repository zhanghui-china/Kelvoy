"""关键帧 (PRD §7): text + persona ref + landmark ref -> image 9:16, via
Qwen-Image/FLUX.1/HunyuanImage. Also hosts 角色一致性's image side (PuLID/
InstantID-style adapters). Not implemented at skeleton stage.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/")
def generate() -> None:
    raise HTTPException(status_code=501, detail="not implemented")
