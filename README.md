# Kelvoy
可旅（Kelvoy） 标语：可旅，让每一场旅行都有vlog。 定位：可旅AI一基于DGX Spark的旅行vlog连续内容引擎。

## Repository Layout

- `apps/web/` — Hono API + React/Vite 前端
- `apps/worker/` — GPU worker（TS），跑在 DGX，只做出站连接
- `services/inference/` — 常驻 Python 推理服务：llm/image/video/upscale
- `packages/engine/` — 流水线核心，`apps/worker` 和 `packages/cli` 共用
- `packages/cli/` — 内部工具：`run <stage> --episode <id>`
- `infra/` — 本地 docker-compose 与 DGX 编排占位
- `docs/` — PRD、架构文档与决策记录（ADR）
- `scripts/` / `spike/` — 辅助脚本 / 一次性硬件验证脚本

## Prerequisites

- [Bun](https://bun.sh) 1.4+
- Python 3.12+ 与 [uv](https://docs.astral.sh/uv/)（仅 `services/inference/` 需要）

详见 [`docs/architecture.md`](docs/architecture.md) 与 [`docs/decisions/`](docs/decisions/)。
