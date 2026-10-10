"""Application settings, loaded from environment variables / `.env`."""

from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central runtime configuration for the inference service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    projects_root: Path = Field(
        default=Path("projects"),
        validation_alias=AliasChoices("KELVOY_PROJECTS_ROOT", "PROJECTS_ROOT"),
    )
    comfyui_base_url: str = Field(
        default="http://127.0.0.1:8188", validation_alias="KELVOY_COMFYUI_BASE_URL"
    )
    bridge_base_url: str = Field(
        default="http://127.0.0.1:5099", validation_alias="KELVOY_BRIDGE_BASE_URL"
    )
    backend_allowed_origins: str = Field(
        default="", validation_alias="KELVOY_BACKEND_ALLOWED_ORIGINS"
    )
    video_timeout_seconds: int = Field(
        default=900, ge=30, le=1800, validation_alias="KELVOY_VIDEO_TIMEOUT_SECONDS"
    )
    host: str = "127.0.0.1"
    # 8000 is taken by visionary-backend on the shared DGX (gx10-8e22) —
    # see infra/dgx/README.md. Don't move this back to 8000.
    port: int = 8100
