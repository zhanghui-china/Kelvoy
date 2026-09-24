# Kelvoy

可旅：虚拟角色 × 真实目的地的旅行 vlog 生产工作台。一期 = 一个角色去一个景区，三个人工审核点，出 24–30 镜、约 30 秒、9:16 的成片。

## 真源

- 产品与数据模型：`docs/AI旅行Vlog生产工作台_PRD_v0.2.md`（v0.1 只留历史，别按它改代码）
- 结构决策：`docs/decisions/`（改目录结构或跨模块边界前先写 ADR）
- 数据类型：`packages/engine/src/schema/` 与 PRD §6 一一对应。**改其一必改另一**，同一个 commit。
- 当前阶段：M0（手工验证）未完成。任何流水线阶段、模型选型、GPU 分钟、定价数字都是占位，别当真。

## 核心工程原则

1. **架构与领域优先**：计划阶段应以理想架构为目标，明确业务目标、领域边界、模块职责、依赖方向和数据流，形成符合领域规律、面向长期维护且可持续演进的设计后再进入编码；不得以短期实现便利牺牲整体设计。设计必须完整，实现应当克制：不做推测性抽象，抽象延迟到第二个真实用例出现时才引入，单一场景直接实现。
2. **追求优雅的代码模块**：模块应高内聚、低耦合，通过精简且稳定的接口封装内部复杂度，使职责、命名、依赖和扩展方式清晰自然；代码按单一职责拆分，单个文件不得超过 500 行，接近上限时应优先重构模块边界。
3. **保持边界与数据流清晰**：协议模型、领域模型、持久化模型和视图模型不得相互泄漏；数据必须在边界处完成校验和独立转换，避免跨层共享可变状态。
4. **安全与隔离默认开启**：所有功能均按多租户、多用户场景设计，明确认证、授权和数据隔离边界；遵循最小权限原则，任何外部输入均视为不可信，敏感信息不得进入代码、日志或响应。
5. **面向并发与故障设计**：后端应主动考虑幂等性、竞态、事务边界、超时、取消、重试、背压和资源释放；不得通过无边界重试、吞错或隐式共享状态掩盖问题。
6. **保障完整前端体验**：前端应控制渲染成本、异步状态和并发请求，保持清晰的 UI 结构；用户流程必须覆盖加载、空状态、错误、重试、反馈和可访问性。
7. **复用稳定的业务语义**：优先复用已有模块和能力，但不要仅因代码外形相似而过早抽象；确需重复时，必须注释说明其独立演进或暂不抽象的原因。新增依赖前先核查项目已有依赖（根 `package.json` 与 `packages/` workspace）能否满足需求，不得臆断已有库缺少功能——先查阅文档和类型定义；确需引入时优先成熟且维护良好的库，不重复实现通用功能。
8. **为未来维护者保留上下文**：代码、注释、测试和架构文档是跨越时间的协作媒介。非显然的设计决策、兼容约束、已知缺陷和临时方案，必须记录原因、影响范围、潜在风险及移除条件；技术债务应关联可追踪任务，关键架构决策应同步到 ADR，禁止留下缺少上下文的 `TODO`。
9. **确保变更可验证、可观测、可回滚**：每项改动都应行为可测试、运行状态可观测、故障可定位，并兼顾向后兼容和回滚路径；错误与日志必须保留诊断上下文，但不得泄露敏感信息。
10. **删除优于兼容**：内部路径重构时直接删除过时实现，禁止新增兼容层、deprecated shim 或双写逻辑；对外契约（`/api/*` 等稳定接口、数据库迁移）的兼容性按协议契约单独评估，属于合同义务而非迁就旧代码。

## 目录职责

| 目录 | 放什么 | 不许放什么 |
| --- | --- | --- |
| `apps/web` | Hono `/api/*` 面向浏览器 + React/Vite 前端（`src/frontend`） | 模型调用、ffmpeg、任何 GPU 相关代码、直连 SQLite（走 `@kelvoy/store`） |
| `apps/worker` | 轮询 `@kelvoy/store` 的任务队列、调 `services/inference`、存产物到本地磁盘、跑 compose | 业务规则（那是 engine 的）、直接拼 SQL（走 `@kelvoy/store`） |
| `services/inference` | 常驻 Python 推理：`/llm` `/image` `/video` `/upscale` | 流水线逻辑、音乐、ffmpeg |
| `packages/engine` | 六阶段 `stages/`、`providers/` 接口与实现、`schema/`、`state/`、`rules/` | 任何 IO：不读写 DB / 文件 / 队列，只吃 JSON 吐 JSON |
| `packages/store` | 唯一拥有 SQLite 连接的地方：`episodes`/`destinations`/`personas`/`templates`/`tasks` 五张表的读写，乐观锁 | 业务规则（校验/状态转移合法性调用 engine，不自己重写一遍） |
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
- M0 未完成不再是不写 M1/M2 真实业务逻辑的理由（2026-09-24 起，与"核心工程原则"一致）：有 M0 阶段性结论的地方（如 M0-4 验证过的 StepFun）直接按结论实现；没有结论的地方按当前最佳判断做出完整设计，后续 M0/M1 实测推翻选型时按新结论改实现，不是从头重设计。

## 不做

- 不做 monorepo 之外的第二套目录方案（ADR-0002 已定）。
- 不给 `spike/` 写测试或 lint。
- 不在没有 ADR 的情况下改 §目录职责表里的分工。
