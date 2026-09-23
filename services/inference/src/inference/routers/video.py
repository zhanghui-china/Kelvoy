"""图生视频 (PRD §7): image (+prompt) -> video 3-5s, via Wan 2.x (I2V,
VACE) / HunyuanVideo I2V / CogVideoX. Not implemented at skeleton stage.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/")
def generate() -> None:
    raise HTTPException(status_code=501, detail="not implemented")
