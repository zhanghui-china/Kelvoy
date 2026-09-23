# 0002 · Repository structure: adopt the PRD's monorepo, superseding 0001

- **Date**: 2026-09-23
- **Status**: Accepted
- **Supersedes**: [0001](0001-lightweight-single-repo-structure.md)

## Context

0001 chose a lightweight single repo, following visionary's precedent, on
the grounds that Kelvoy had no independently deployable services beyond one
optional GPU bridge. `docs/AI旅行Vlog生产工作台_PRD_v0.1.md` §9 changes that:

1. **Outbound-only DGX security boundary.** The GPU workers must make only
   outbound connections (pull queue, push object storage) and accept zero
   inbound traffic — no public attack surface on the DGX boxes. That
   requires the GPU-worker code (`apps/worker`) to be a genuinely separate
   deployable unit from the web/API code (`apps/web`), not just an
   independent process sharing a repo layout as `dgx-bridge/` was — the
   inbound-`/health`-bridge shape is architecturally wrong for this
   constraint and has been replaced outright.
2. **Worker + CLI share one pipeline core.** PRD §9 explicitly requires
   `packages/engine` to be IO-free and shared verbatim by both
   `apps/worker` and `packages/cli` ("worker 和 CLI 都只是调用方"). A single
   repo with no package boundaries can't express "two independent runtime
   entry points consume one versioned internal library" as cleanly as a
   workspace can — this is the concrete case 0001 said would justify
   revisiting the decision.

## Decision

Adopt the PRD §9 layout as a Bun workspace: `apps/web`, `apps/worker`,
`services/inference`, `packages/engine`, `packages/cli`, `infra/`. Python is
now confined entirely to `services/inference/` (repurposed from
`src/kelvoy/`); `dgx-bridge/` and root-level `src/kelvoy/`, `web/`,
`pyproject.toml`/`uv.lock` are removed.

## Consequences

- Two CI workflows instead of one: a Bun-workspace-wide `ts-ci.yml` and a
  `services/inference`-scoped `inference-ci.yml`. Per-package TS CI can be
  split out later once `apps/web`/`apps/worker` have independent deploy
  pipelines — premature now.
- `packages/engine` has no build step yet (Bun/Vite consume its TS
  directly); revisit if it's ever consumed outside this monorepo.
- This reverses 0001; 0001 is left in place (marked Superseded, not
  deleted) for history.
