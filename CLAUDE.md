# Kelvoy

可旅：虚拟角色 × 真实目的地的旅行 vlog 生产工作台。一期 = 一个角色去一个景区，三个人工审核点，出 24–30 镜、约 30 秒、9:16 的成片。

## 真源

- 产品与数据模型：`docs/AI旅行Vlog生产工作台_PRD_v0.2.md`（v0.1 只留历史，别按它改代码）
- 结构决策：`docs/decisions/`（改目录结构或跨模块边界前先写 ADR）
- 数据类型：`packages/engine/src/schema/` 与 PRD §6 一一对应。**改其一必改另一**，同一个 commit。
- 当前阶段：M0（手工验证）未完成。任何流水线阶段、模型选型、GPU 分钟、定价数字都是占位，别当真。

## 目录职责

| 目录 | 放什么 | 不许放什么 |
| --- | --- | --- |
| `apps/web` | Hono API（`src/server`，含 `/internal/*` 供 worker 回写）+ React/Vite 前端（`src/frontend`） | 模型调用、ffmpeg、任何 GPU 相关代码 |
| `apps/worker` | 拉队列、调 `services/inference`、调 `/internal/*` 回写、推对象存储、跑 compose | 入站 HTTP 服务、直连 Postgres、业务规则（那是 engine 的） |
| `services/inference` | 常驻 Python 推理：`/llm` `/image` `/video` `/upscale` | 流水线逻辑、音乐、ffmpeg |
| `packages/engine` | 六阶段 `stages/`、`providers/` 接口与实现、`schema/`、`templates/` | 任何 IO：不读写 DB / 对象存储 / 队列，只吃 JSON 吐 JSON |
| `packages/cli` | `run <stage> --episode <id>`、`import-destination <json>` | 面向用户的功能 |
| `infra` | docker-compose（本地）、Spark 编排占位 | 密钥 |
| `docs` | PRD、ADR、架构状态、手册 | 代码 |
| `spike` | 一次性验证脚本，不 lint、不测 | 会被 import 的代码 |

## 不可越的边界

- worker 只做出站连接。要让 worker 拿数据，就在 `apps/web` 加 `/internal/*` 路由，不要给 worker 开端口或发 DB 凭证。
- Postgres 里的期 jsonb 是唯一真源；对象存储只放二进制产物。
- `compose` 是唯一碰 ffmpeg 的地方，只在 worker 上跑。
- 每个 provider 只做一件事：把统一接口翻译成一个后端，并记录 provider/model/version/seed/cost。换模型不改上层。
- 重跑跳过 `approved` 的镜；重新合成不动任何镜。

## 命令

```bash
make install     # bun install + services/inference uv sync
make typecheck   # 四个 TS 包
make test        # bun test + pytest
make lint        # ruff（TS 侧 lint 工具未定）
make web-api / web-app / worker / inference   # 各自 dev
bun run packages/cli/src/index.ts run <stage> --episode <id>
```

改完必须跑 `make typecheck && make test`，绿了才算完。

## 约定

- Bun workspace，包名 `@kelvoy/*`，`exports` 直接指 `./src/index.ts`，没有构建步骤。不引入 turborepo/nx。
- TS：strict，`noUnusedLocals/Parameters` 开着，占位参数加 `_` 前缀。测试文件 `*.test.ts` 与源码同目录，用 `bun:test`。
- Python 只在 `services/inference`，uv 管理，ruff 100 列。
- 文档、PRD、commit 正文用中文；代码标识符、注释、prompt 模板里的 key 用英文；给模型的 prompt 内容用中文。
- 占位实现统一 `throw new Error("not implemented")`，不要写假逻辑假装能跑。
- 不提前加依赖：队列客户端、对象存储 SDK、ORM 都还没选，需要时先在 ADR 里定。
- 不为 M0 之后的阶段写业务逻辑（真实 prompt、ffmpeg 参数、溢出策略）——M0 实测会改掉它们。

## 不做

- 不做 monorepo 之外的第二套目录方案（ADR-0002 已定）。
- 不给 `spike/` 写测试或 lint。
- 不在没有 ADR 的情况下改 §目录职责表里的分工。
