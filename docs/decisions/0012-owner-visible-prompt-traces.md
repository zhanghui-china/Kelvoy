# ADR-0012：作品所有者可见的提示词记录

状态：已采纳（2026-10-11），设计已定，未实现

**修订**：[ADR-0011](0011-h3-prompt-writing.md) 及 `packages/store/src/task-diagnostics.ts` 注释中「原始提示词与响应绝不入库」的约定，在下文划定的边界内放宽。不是推翻，见「约定变更」。

产品调研需要在界面上看到「发给模型的提示词」。可见范围仅限作品所有者看自己创建的作品。

## 已确认的产品决定

1. 覆盖脚本生成与脚本优化的整段提示词（含自动纠错每一轮），以及视频步骤发给 StepFun 的 H3 改写用户消息和最终发给视频模型的英文提示词。
2. 每次生成／重试产生的版本全部保留，不只保留最后一版。
3. 失败尝试（含 `prompt_format_invalid`、内容拦截）也记录并展示，标「未通过校验」。
4. 页面上是默认折叠的展开按钮，展开才请求，可复制。
5. 参考图存储路径对所有者也隐藏，视图层替换为占位（保留 role 与 picture 序号）；完整 `input_hash` 只留库内，视图只给前 12 位。
6. H3 缓存命中单独成一条，标「命中缓存，沿用此前改写结果」。
7. 历史作品不回填：视频仅以 `model.video.prompt` 显示「仅保留最终提示词」，脚本显示「上线前未保留」。
8. 本期不展示、不入库 H3 系统提示词全文（指南约 42KB），只存版本引用 `skill_version`（指南哈希）、`writer_version`、`model`、`mode`。以后若需要，另加内容寻址表 `prompt_blobs`，不改本次表结构。

## 存储

新增 `packages/store` 内部表 `prompt_traces`，只追加行。

- 主键 `(task_id, attempt, seq)`。幂等键不能用 `generation_id`：视频重试沿用旧 `generation_id`，会把不同版本合并。
- 归属：`episode_id`、`owner_id`。`owner_id` 在 SQL 中由 `episodes` 行取得，不信任调用方传入。
- 分类：`kind` ∈ `script_generate` / `script_revision` / `h3_rewrite`；`shot_id`（仅视频）；`round`（脚本纠错轮次）；`source` ∈ `llm` / `cache`；`outcome`；`rule`（`H3FormatError.rule` 的固定标识）。
- 版本引用：`model`、`skill_version`、`writer_version`、`h3_mode`。
- 内容：`user_message`（脚本为整段 prompt；视频为 `JSON.stringify(context)`）、`correction_message`、`final_prompt`、`input_hash`、`truncated`、`created_at`。
- 索引 `(episode_id, kind, shot_id)`；SQLite 不允许在索引里显式列 `rowid`，它本就隐式追加在每个索引末尾，因此等价于 `(…, rowid)`，服务按作品、类别、镜头的时间序读取。
- 限额：每个文本字段写入时截断为 64KB 并置 `truncated=1`；单次执行最多 16 条。

为什么不放别处：

- 不放 episode 文档：文档被前端每 3 秒轮询整份返回，受乐观锁约束，`shared_storyboard` 还会复制 shots。提示词会放大每次轮询体积，并随分享快照扩散。
- 不放 `tasks.result_json`：作品删除清理会将其置空，语义是任务结果，且不便按镜头、版本查询。

## 写入路径

Engine 不返回 trace，也不碰 IO：它接收一个只写回调 `PromptTraceSink`，在每次模型调用前后上报。提示词不得放进 `Error`，因为 Error 会被 `JSON.stringify` 和日志带出。

Worker 为每次任务执行持有一个收集器，并在已有的「租约校验 + 事务提交」里一并写入：

- 成功路径：`completeTaskWithEpisode`。
- 失败路径：`failTaskWithCredits`，requeue 与终态都写。
- 不写：`completeTaskWithoutEpisode`、`version_conflict`、`illegal_transition`、租约丢失、用户取消。租约丢失不写是 `ownsLiveLease` 带来的结构性保证，不需要额外判断。

两个提交函数（均在 `packages/store/src/charged-tasks.ts`）新增一个可选参数承载收集到的行。省略时行为与现状完全一致。

### 写入失败是否影响结算

选择：trace 写入与结算在同一个 SQLite 事务里，用 `on conflict (task_id, attempt, seq) do nothing` 只忽略主键重复；其他任何失败（含 CHECK／NOT NULL 违例）都抛出并让整个事务回滚，不吞错。

注意不能用 `insert or ignore`：它会连 CHECK 与 NOT NULL 违例也静默丢弃（实测返回 0 行、不报错），即 Worker 运行时传入非法 `kind` 或缺失 `user_message` 时结算成功但记录悄悄缺失，正是本节要避免的情形。

理由：

- 吞错意味着任务成功、积分结算后得到一份「静默缺失」的记录，且无人知道。这违反「不得掩盖问题」。
- 同事务回滚让任务按既有路径处理：租约仍有效，走现有的重试／提交冲突处理，不引入新的无边界重试，也不新增补写队列。
- 失败面被压到很小：主键含 `attempt` 与 `seq`，`on conflict do nothing` 消除重复键；文本已被截断，行数限为 16；`owner_id`／`episode_id` 来自事务内已读到的 `episodes` 行。正常情况下该语句不会失败，只剩磁盘满、库损坏这类整个事务本来就会失败的情形。
- 代价：极端故障下 trace 的故障会拖住一次结算。接受这个代价，因为这些故障本身已让结算不可靠。

## 读取

`GET /api/episodes/:id/prompts?kind=script|video&shot_id=&limit=&before=`，协议见 [提示词记录 API](../api/prompt-traces.md)。

- 沿用 `loadOwnedEpisode`（`apps/web/src/server/routes/episode-common.ts`）所有者校验；他人、不存在、已删除一律返回同一个 404 体。
- 视图模型在边界处脱敏（参考图路径、完整 `input_hash`），不直接返回库行。
- 响应带 `Cache-Control: no-store`。

## 生命周期

- 随作品存续，不做自动淘汰。每作品估算不足 1MB，属推测，实施后以真实数据复核。
- `deleteEpisode`（`packages/store/src/episode-deletion.ts`）在同一事务内删除该作品的 trace。插入要求 `episodes` 行存在，因此删除之后迟到的 Worker 提交落不进来。
- 磁盘 `h3-prompts/` 缓存目录由现有整目录清理处理（见 [永久删除作品](../api/episode-deletion.md)）。

## 约定变更

原约定：原始提示词与响应绝不入库。

新约定：

- 原始 LLM 响应与系统提示词全文仍不入库。
- 用户消息与最终提示词仅所有者可经 `/api/episodes/:id/prompts` 读取。
- 绝不进入日志、`tasks.error`、诊断 JSON、分享接口、CSV 导出、运维诊断，以及其他任何公开出口。

为什么是有边界的修订：产品需要的是所有者可审阅「实际发出了什么」。这需要持久化用户消息与最终提示词，但不需要响应原文和系统提示词。放宽范围只到需求为止；诊断、日志等运维面的纪律不变。同步修改的注释位于 `packages/store/src/task-diagnostics.ts` 与 `apps/worker/src/generation/diagnostics.ts`，只改措辞。

## 迁移与回滚

- 加性迁移：`create table if not exists` / `create index if not exists`，由 `packages/store/src/db.ts` 每次打开数据库时随 SCHEMA（`schema.ts`）执行。可选记录 `schema_migrations('prompt_traces_v1')`。
- 旧版 Web／Worker 打开新库只会忽略该表，回滚不需要恢复数据库。回滚后不再产生也不再读取 trace。

## 发布与备份

- 数据库备份现在含提示词，须与其他用户数据同级保管。
- `infra/dgx/deploy-web-worker.py` 用 `database_snapshot` 比对暂停期间的库摘要。Web 启动打开数据库时会创建新表，脚本会把它误判为「Paused database changed」并回退。发布前须改造为：原有表摘要不变，仅允许新增指定的表与索引（白名单）。具体比对方式待实现时确认。
- 前端有新增界面，发布须重建前端 dist。

## 安全

对所有者展示的风险：

- 同一账号多人共用时，提示词对所有使用者可见。
- 将来有人误把 trace 接入分享或导出。

已核对不会带出的位置：

- 分享接口（`apps/web/src/server/routes/share.ts`）使用显式白名单投影，`share.test.ts` 有哨兵测试。
- 日志只含 `rule`、`corrected`、耗时（见 `apps/worker/src/generation/diagnostics.ts`）。
- `tasks.error` 只写 `TaskDiagnostic`。
- 前端脚本导出（`apps/web/src/frontend/review/scriptExport.ts`）只用 episode 文档里的原稿。

约束：新增任何对外输出前必须评估是否含 trace；trace 视图模型不得被其他路由复用。实现时应补哨兵测试，覆盖分享接口与诊断输出不含 trace 内容。

## 被否决的方案

- 放 episode 文档：见「存储」。
- 放 `tasks.result_json`：见「存储」。
- 把 trace 挂在 `Error` 上：Error 会被序列化与日志带出，提示词泄漏面不可控。
- 存系统提示词全文：约 42KB 且随版本重复，产品当前不需要；以版本引用代替，需要时再加 `prompt_blobs`。
- 运维或他人可见：产品只确认所有者可见，扩大范围需要独立的授权与隐私决策。
- 回填历史作品：旧作品没有当时的完整输入，回填只能是编造；以明确的占位提示代替。

## 后果与风险

- charged-tasks 提交路径新增可选参数，并在事务内多一次写入。
- 数据库增长：随作品存续，无自动淘汰；若真实体量超出估算，需另议保留策略。
- 提示词在备份中留存，运维保管要求提高。
- 发布流程须先改造 `deploy-web-worker.py` 的库摘要比对，否则发布会自动回退。
