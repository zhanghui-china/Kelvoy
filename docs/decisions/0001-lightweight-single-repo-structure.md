# 0001 · Repository structure: lightweight single repo, not a monorepo

- **Date**: 2026-09-23
- **Status**: Superseded by [0002](0002-monorepo-for-dgx-security-and-shared-engine.md)

## Context

Visionary (Kelvoy's sibling AI-content-generation project) originally planned
an `apps/services/packages/` Turborepo-style monorepo, then abandoned it in
favor of a single lightweight repo (`src/<pkg>/`, `web/`, an independent GPU
bridge service, flat `docs/`/`tests/` trees) — see visionary's
`docs/REPOSITORY_STRUCTURE.md` "已废弃的原始方案" appendix for the full
before/after and the tradeoffs that drove the change.

Kelvoy shares the same tech stack (Python/FastAPI + uv backend, React/Vite/TS
frontend, independent GPU-bridge microservice) and the same scale of team/
codebase that made the monorepo unnecessary overhead for visionary.

## Decision

Kelvoy follows visionary's already-validated lightweight single-repo layout
from day one, rather than re-deriving it (or re-trying the monorepo path)
from scratch:

- `src/kelvoy/` — backend (uv + hatchling, Python 3.12+)
- `web/` — frontend (Vite + React + TS)
- `dgx-bridge/` — independent GPU/model bridge microservice (own
  pyproject.toml/uv.lock), analogous to visionary's `comfyui-bridge/`
- `docs/`, `tests/`, `scripts/`, `spike/` at the root, flat (no nested
  package boundaries)

No `apps/`, `services/`, or `packages/` directories.

## Consequences

- Single `pyproject.toml`/`uv.lock` for the backend keeps dependency
  management simple as long as the team/codebase stays small.
- If Kelvoy later needs independently deployable backend services (not just
  the already-independent GPU bridge), this decision should be revisited —
  same trigger condition visionary's own structure doc calls out.
