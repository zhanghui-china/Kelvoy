"""Shared request/response shapes for the four inference routers (M1-8).

Mirrors packages/engine/src/providers/inference-types.ts on the TS side —
kept in sync by hand (no codegen yet, the surface is small). Model-specific
parameters (sampler, guidance scale, resolution presets, ...) all go into
`params` rather than getting named fields here, so this shape doesn't need
to change every time a new model is swapped in.
"""

from pydantic import BaseModel, Field


class InferenceRequest(BaseModel):
    prompt: str
    refs: list[str] = Field(default_factory=list)
    seed: int | None = None
    size: str | None = None
    count: int | None = None
    params: dict = Field(default_factory=dict)


class InferenceResponse(BaseModel):
    paths: list[str]
    model: str
    version: str
    seed: int
    seconds: float
