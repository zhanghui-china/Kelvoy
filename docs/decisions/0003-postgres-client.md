# 0003 · Postgres 客户端：postgres.js，不用 ORM

- **Date**: 2026-09-23
- **Status**: Accepted

## Context

M1-2（`import-destination` CLI）要把校验过的目的地包写进 Postgres，这是仓库第一处真正连 DB 的代码。PRD v0.2 §11 把 ORM 选型列为开放问题，CLAUDE.md 也明确"不提前加依赖……需要时先在 ADR 里定"——现在就是"需要时"。

候选：Drizzle / Prisma / Kysely（ORM 或查询构建器）vs 裸 `postgres`（postgres.js，纯 SQL 客户端）。这个阶段只有一张表、一条写入路径（`import-destination`），且 M1 后续还要给 `/internal/*` 加 Postgres 读写（M1-1 的 handler 目前是 501），字段和表结构都还在变。

## Decision

用 [`postgres`](https://github.com/porsager/postgres)（postgres.js）：一个轻量的原生 SQL 客户端，不引入 ORM 或查询构建器。迁移写成纯 `.sql` 文件放 `infra/migrations/`，按序号执行，不用迁移框架。

- `packages/cli` 和以后 `apps/web` 各自按需引入 `postgres` 依赖，连接串读 `DATABASE_URL`。
- 目的地记录整条存 `doc jsonb`，加 `destination_id`（主键）/`version`/`updated_at` 便于查询和乐观锁，不拆字段建表——和期（Episode）在 §6 里"Postgres 一条记录 jsonb"的存法一致。

## Consequences

- 表结构变化只需要加一份新的 `.sql` 迁移文件，没有 ORM 版本迁移的额外机制。
- 换 ORM 的成本被推迟但没有消失：等 `/internal/*` 真正接 DB、查询变复杂（按 owner_id 过滤、分页、join）时，如果裸 SQL 开始难维护，再评估要不要引入 Kysely 这类类型安全的查询构建器——不是现在。
- CI 里没有真实 Postgres，涉及 DB 的测试用 `test.skipIf(!process.env.DATABASE_URL)` 跳过，只在本地（`infra/docker-compose.local.yml` 起的 Postgres）或未来的 CI DB 服务下跑。
