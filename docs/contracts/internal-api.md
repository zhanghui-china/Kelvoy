# 内部 API 契约（apps/web ↔ apps/worker）

类型定义是唯一真源：`packages/engine/src/schema/api.ts`。这份文档只是导航，字段改动只改那个文件，这里不重复维护类型。

## 为什么需要

`apps/worker` 跑在 DGX 上，只做出站连接（PRD v0.2 §9）——不开入站端口，不直连 Postgres。它要读期数据、回写状态，只能反过来主动调 `apps/web` 暴露的内部路由。

## 端点

全部挂在 `apps/web` 的 `/internal` 前缀下（见 `apps/web/src/server/routes/internal.ts`），只有 `apps/worker` 调用，不面向公网、不面向前端。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/internal/episodes/:id` | — | `GetEpisodeResponse` |
| PATCH | `/internal/episodes/:id` | `PatchEpisodeRequest` | `PatchEpisodeResponse` \| 409 `VersionConflict` |
| PATCH | `/internal/episodes/:id/shots/:no` | `PatchShotRequest` | `PatchShotResponse` \| 409 `VersionConflict` |

## 鉴权

`Authorization: Bearer <WORKER_INTERNAL_TOKEN>`，两端从同一个环境变量读。中间件对 `/internal/*` 下所有路由生效，没有例外。token 只在 worker 侧持有，不下发给浏览器。

## 乐观锁

每次 `GET` 返回 `row_version`（Postgres 行版本号，和 `persona_version`/`destination_version` 是两回事——那两个是角色/目的地的领域快照版本，这个是并发写保护）。每次 `PATCH` 必须带上读到的 `row_version`；服务端比对不一致就拒绝，返回 `VersionConflict`，worker 收到后重新 `GET` 再重试，不覆盖别人的写入。

这解决的问题：两台 Spark 同时对同一期的不同镜发起回写时，不会互相踩掉。

## PatchShotRequest 能改什么

只能改 `status / candidates / kf_selected / clip / trim_start_s / regen_stage / bad_shot_reported / model`。`scene / camera / beat` 这些脚本阶段的产出不归 worker 改。

## PatchEpisodeRequest 能改什么

只能改 `status / credits_used / grid_refs / render / music`。`brief / scenes / shots` 不在这里改——shots 走上面那条镜级接口。

## 现状

M1-1（本 issue）只交付契约类型 + 路由骨架 + 鉴权中间件，handler 目前都是 501。真正接 Postgres 读写是后续 issue（依赖 DB client/ORM 选型，尚未定）。
