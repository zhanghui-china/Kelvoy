# Kelvoy
可旅（Kelvoy） 标语：可旅，让每一场旅行都有vlog。 定位：可旅AI一基于DGX Spark的旅行vlog连续内容引擎。

## Repository Layout

- `src/kelvoy/` — 后端（FastAPI，`uv` 管理依赖）
- `dgx-bridge/` — 独立的 GPU/模型桥接服务，负责对接 DGX Spark
- `web/` — 前端（Vite + React + TypeScript）
- `docs/` — 架构文档与决策记录（ADR）
- `tests/` — 后端测试
- `scripts/` / `spike/` — 辅助脚本 / 一次性硬件验证脚本

## Prerequisites

- Python 3.12+ 与 [uv](https://docs.astral.sh/uv/)
- Node 18+ 与 npm

详见 [`docs/architecture.md`](docs/architecture.md) 与 [`docs/decisions/`](docs/decisions/)。
