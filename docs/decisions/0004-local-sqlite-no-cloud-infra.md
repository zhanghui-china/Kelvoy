# 0004 · MVP 不用云端基础设施：本地 SQLite + 本地磁盘，取消 Redis/Postgres/对象存储

- **Date**: 2026-09-23
- **Status**: Accepted
- **Supersedes**: [0003](0003-postgres-client.md)（选型本身不算错，是前提变了）

## Context

ADR-0003 和 PRD v0.2 §9 的架构都建立在"云上 web+DB + Redis 队列 + DGX worker 出站拉取 + 对象存储"这套假设上。用户明确纠正：**MVP 阶段基本不用云端组件，除了 LLM**。不考虑 Redis、Postgres、对象存储。

这和团队自己另一个项目 visionary 的实际做法一致——那边压根没有 Postgres/Redis/S3，数据就是本地 JSON 文件（`~/visionary/projects/`、`users.json`、`config.json`）。不是标新立异，是回到这个团队验证过的轻量做法。

进一步确认：
- 数据（期/角色/目的地）存本地 **SQLite**（不是纯 JSON 文件——保留基本查询能力和乐观锁）。
- 仍然需要异步任务（生成一期要几十分钟，HTTP 请求不能同步等），但任务队列不用 Redis，改成 SQLite 里的 `tasks` 表。
- 产物文件（关键帧、视频片段、成片）存本地磁盘目录，不用对象存储。
- 部署拓扑：**暂时 web/worker/推理都在同一台机器**，但要设计成以后能拆到不同机器——用户预期以后生图/生视频/ffmpeg 可能分到不同 DGX 上。所以现在不是"合并成一个进程随便互相调用"，而是通过一个清晰的模块边界（新增 `packages/store`）访问数据，边界内部现在是直接 SQLite 调用，以后如果要跨机器可以把这层换成网络调用而不动上层代码。

## Decision

- 新增 `packages/store`：唯一拥有 SQLite 连接和 schema 的地方。`apps/web`、`apps/worker`、`packages/cli` 都通过它的函数访问数据，不直接碰 SQLite 文件。函数签名保持 `async`（哪怕现在的实现是同步的 `bun:sqlite`），这样以后换成网络实现时上层调用代码不用改。
- SQLite 文件：`data/kelvoy.db`（gitignore，运行时生成，参考 `services/inference` 的 `projects_root` 同一套"运行时数据不进 git"的规矩）。
- 表：`episodes`（`episode_id` pk、`owner_id`、`row_version`、`doc` TEXT 存 JSON、`updated_at`）、`destinations`（同构，替代原 Postgres 表）、`tasks`（`task_id` pk、`episode_id`、`stage`、`shot_no`、`attempt`、`status`、`created_at`、`updated_at`——替代 Redis 队列）。
- 产物文件：本地目录 `projects/<episode_id>/{kf,clip,final}/...`，路径存进 `doc` 里的字符串字段（`Shot.candidates`/`kf_selected`/`clip` 这些字段不变，只是不再指向对象存储 key，指向本地相对路径）。
- **废弃**：`docs/contracts/internal-api.md` 描述的 HTTP `/internal/*` 层整个去掉——web 和 worker 现在通过 `packages/store` 直接函数调用，不需要一层 HTTP 包装。乐观锁的 `row_version` 语义保留，但校验发生在 `packages/store` 的函数里，不是 HTTP handler 里。
- **废弃**：`infra/migrations/*.sql`（Postgres 方言）、`infra/docker-compose.local.yml` 里的 postgres/redis/minio 服务、ADR-0003 选的 `postgres` 依赖。
- Bun 内置 `bun:sqlite`，不需要额外选型/加依赖——这点比 ADR-0003 当时的处境简单，不用再写一份"选型 ADR"。

## 旧代码怎么处理

- **保留**：#9 状态机（`packages/engine/src/state/`）——纯函数不碰存储，完全不受影响。`packages/engine/src/schema/*`（Episode/Shot/Destination 等类型）、`packages/engine/src/schema/validate.ts`、`packages/engine/src/rules/script.ts`——这些都是纯逻辑，不碰。
- **重做**：
  - `packages/cli/src/import-destination.ts` / `db.ts`：改成调 `packages/store`，不再直连 Postgres。
  - `apps/web/src/server/routes/internal.ts` 及其挂载：删除（不再需要 HTTP 内部 API）。
  - `apps/worker/src/queue/consumer.ts`：改成从 `packages/store` 的 `tasks` 表拉任务，不是 Redis。
  - `packages/engine/src/schema/api.ts`：`Task` 类型保留（队列payload 形状还是需要），`GetEpisodeResponse`/`PatchEpisodeRequest`/`PatchShotRequest`/`VersionConflict` 这些改到 `packages/store` 里作为函数参数/返回类型，不再是"HTTP 请求体"的语义。
- **作废**：ADR-0003、`infra/migrations/0001_destinations.sql`、`0002_episodes.sql`、`docs/contracts/internal-api.md`（整份，不只是现状段）。

## Consequences

- 本地开发和部署都简单很多：不需要 Docker 起 Postgres/Redis/MinIO，`bun:sqlite` 内置，测试不需要 `test.skipIf(!DATABASE_URL)` 这种跳过逻辑，直接用临时 SQLite 文件测。
- 单机部署意味着当前没有"一台 DGX 宕机不停服"这种冗余——PRD v0.2 §8/§9 里跟这个相关的表述需要一起改（不在本 ADR 范围，PRD 更新单独走）。
- 以后要跨机器拆分时，`packages/store` 是唯一要改的地方（把内部实现从 `bun:sqlite` 换成打 HTTP 或别的 RPC），但对外函数签名不用变——这是刻意为将来预留的口子，不是过度设计：用户已经明确说了"以后可能生图/生视频/ffmpeg 分不同 DGX"。
