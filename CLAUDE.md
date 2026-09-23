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
| `apps/web` | Hono `/api/*` 面向浏览器 + React/Vite 前端（`src/frontend`） | 模型调用、ffmpeg、任何 GPU 相关代码、直连 SQLite（走 `@kelvoy/store`） |
| `apps/worker` | 轮询 `@kelvoy/store` 的任务队列、调 `services/inference`、存产物到本地磁盘、跑 compose | 业务规则（那是 engine 的）、直接拼 SQL（走 `@kelvoy/store`） |
| `services/inference` | 常驻 Python 推理：`/llm` `/image` `/video` `/upscale` | 流水线逻辑、音乐、ffmpeg |
| `packages/engine` | 六阶段 `stages/`、`providers/` 接口与实现、`schema/`、`state/`、`rules/` | 任何 IO：不读写 DB / 文件 / 队列，只吃 JSON 吐 JSON |
| `packages/store` | 唯一拥有 SQLite 连接的地方：`episodes`/`destinations`/`tasks` 三张表的读写，乐观锁 | 业务规则（校验/状态转移合法性调用 engine，不自己重写一遍） |
| `packages/cli` | `run <stage> --episode <id>`、`import-destination <json>` | 面向用户的功能 |
| `infra` | DGX 编排笔记（`dgx/README.md`） | 密钥、容器编排配置（ADR-0004 后不需要了） |
| `docs` | PRD、ADR、架构状态、手册 | 代码 |
| `spike` | 一次性验证脚本，不 lint、不测 | 会被 import 的代码 |

## 不可越的边界（ADR-0004）

- 不用云端基础设施，除了 LLM 调用。没有 Postgres、没有 Redis、没有对象存储。
- SQLite（`data/kelvoy.db`，`@kelvoy/store` 管）是期/角色/目的地的唯一真源；产物文件是本地磁盘 `projects/<episode_id>/...`。
- `apps/web` 和 `apps/worker` 都通过 `@kelvoy/store` 的函数访问数据，不直连 SQLite、不互相开 HTTP 内部 API——暂时同机，但 `@kelvoy/store` 的函数签名保持 `async`，为将来拆到不同机器留口子（用户预期以后生图/生视频/ffmpeg 可能分不同 DGX）。
- `compose` 是唯一碰 ffmpeg 的地方，只在 worker 上跑。
- 每个 provider 只做一件事：把统一接口翻译成一个后端，并记录 provider/model/version/seed/cost。换模型不改上层。
- 重跑跳过 `approved` 的镜；重新合成不动任何镜。

## 命令

```bash
make install     # bun install + services/inference uv sync
make typecheck   # 五个 TS 包
make test        # bun test + pytest（SQLite 测试用 :memory:，不需要起任何服务）
make lint        # ruff（TS 侧 lint 工具未定）
make web-api / web-app / worker / inference   # 各自 dev
bun run packages/cli/src/index.ts run <stage> --episode <id>
bun run packages/cli/src/index.ts import-destination <path.json>
```

改完必须跑 `make typecheck && make test`，绿了才算完。

## 约定

- Bun workspace，包名 `@kelvoy/*`，`exports` 直接指 `./src/index.ts`，没有构建步骤。不引入 turborepo/nx。
- TS：strict，`noUnusedLocals/Parameters` 开着，占位参数加 `_` 前缀。测试文件 `*.test.ts` 与源码同目录，用 `bun:test`。
- Python 只在 `services/inference`，uv 管理，ruff 100 列。
- 文档、PRD、commit 正文用中文；代码标识符、注释、prompt 模板里的 key 用英文；给模型的 prompt 内容用中文。
- 占位实现统一 `throw new Error("not implemented")`，不要写假逻辑假装能跑。
- 不提前加依赖：真要加新依赖（不是 `bun:sqlite`/`node:fs` 这种内置的），先在 ADR 里定。
- 不为 M0 之后的阶段写业务逻辑（真实 prompt、ffmpeg 参数、溢出策略）——M0 实测会改掉它们。

## 不做

- 不做 monorepo 之外的第二套目录方案（ADR-0002 已定）。
- 不给 `spike/` 写测试或 lint。
- 不在没有 ADR 的情况下改 §目录职责表里的分工。
