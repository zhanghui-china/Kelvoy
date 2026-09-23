"""脚本/分镜 (PRD §7): brief + destination pack -> shots JSON, via vLLM.
Also hosts 角色一致性's text side. Not implemented at skeleton stage.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/")
def generate() -> None:
    raise HTTPException(status_code=501, detail="not implemented")
