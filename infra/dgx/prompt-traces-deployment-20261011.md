# 提示词记录（ADR-0012）发布与 LLM 型号切换（2026-10-11）

两件事同日完成：提示词记录功能双节点上线（带加性数据库迁移），以及两个节点的 `STEPFUN_MODEL` 切换到 `step-5-preview`。素材未备份也未触碰。

## 一、提示词记录发布

功能范围见 [ADR-0012](../../docs/decisions/0012-owner-visible-prompt-traces.md) 与 [提示词记录 API](../../docs/api/prompt-traces.md)：新增 `prompt_traces` 表，Worker 在结算事务内写入，`GET /api/episodes/:id/prompts` 脱敏只读返回，审核台新增默认折叠的提示词面板。

| 节点 | 发布目录 | 源码 | 数据库备份（UTC） | 切换时间 |
| --- | --- | --- | --- | --- |
| Spark | `~/kelvoy-releases/prompt-traces-20261011-573aa90` | `573aa90`＋修复后的 `deploy-web-worker.py` | `/home/Developer/kelvoy-backups/pre-prompt-traces-20261011-20261011T032307Z` | 03:23 |
| GX10 | `~/kelvoy-releases/prompt-traces-20261011-6946b27` | `6946b27` | `/home/huntun/kelvoy-backups/pre-prompt-traces-20261011-20261011T033258Z` | 03:33 |

发布方式沿用"变更包＋`cp -a` 当前线上发布目录＋覆盖"：变更包约 100KB、55–59 个代码文件，在节点上重建前端并 `dist_stamp stamp`。Inference 不动，素材不备份不比对，数据库做一致性备份。

### 验证

- 节点上类型检查通过；engine／store／worker／web 共 1076 项测试：1075 通过、1 项平台条件跳过、0 失败；基础设施 Python 测试通过。
- 迁移预演（对生产库副本，对原库只读）两节点均两遍幂等：只新增 `prompt_traces`、`idx_prompt_traces_episode`、PK 自动索引与迁移 `prompt_traces_v1`，新表 0 行。
- 切换后：三个服务 active、重启 0，健康检查 `ok`，近 3 分钟日志无错误；Spark 公网 `:8063` 与 GX10 Tailscale 入口正常。
- 隔离验收 [`verify-prompt-traces.ts`](verify-prompt-traces.ts)（临时库与临时端口，用部署的真实代码），两节点各 12 项全过：脚本两轮倒序、视频失败尝试带规则标识、参考图路径与完整哈希脱敏、无内部 ID、历史回退 `final_only`、他人账号与不存在的作品返回同一个 404、未登录 401、分享接口只有白名单字段且不含记录与内部路径、作品详情不含记录文本、删除作品后记录清空。生产库在验收后仍为 0 条记录、无验收账号。

### 过程中的两个问题（均已修复并有测试）

1. **drop-in 排序**：Spark 前三次切换自动回退，没有副作用。systemd 按文件名字典序合并 drop-in，后者覆盖前者；旧脚本固定用 `zzzzzzzzzz-<名字>.conf`，`prompt-traces` 排在已有的 `rule-diag`、`share-projection` 之前，被旧 drop-in 覆盖，工作目录仍是旧版。修复：新 drop-in 比现有的多一个前导 `z`（`test_dropin_order.py`）；工作目录核对失败时输出实际 PID、属性值与 cwd。
2. **加性迁移闸门空转**：Web 懒加载打开数据库，启动后再比较时表尚未创建，Spark 的 `deployment.json` 因此记录 `new_tables: []`、`absent_new_tables: ["prompt_traces"]` 却显示通过。Spark 上结果无误（预演与事后核对均正确），但当时闸门没有真正验证。修复：备份后在服务停止状态下用发布版 store 显式 `open()` 应用迁移，再与备份比较；名单内的表或迁移 id 缺席即失败（`test_additive_gate.py`）。GX10 使用修复后的闸门，记录为 `new_tables: ["prompt_traces"]`、`absent_*` 为空。

### 回退

先确认无生成任务，在对应节点：删除 `kelvoy-{web,worker}.service.d/zzzzzzzzzzz-prompt-traces-20261011.conf`，`daemon-reload` 后重启 Web／Worker，回到 `share-projection-20261011-1d41910`（`1d41910`）。新表与迁移记录保留，旧版本忽略它；不恢复数据库，避免覆盖上线后的新数据和删除审计。备份仅用于核对和人工恢复。

## 二、LLM 型号切换到 `step-5-preview`

此前两个节点都没有设置 `STEPFUN_MODEL`，使用代码默认值 `step-3.5-flash`。脚本生成、脚本优化与 H3 视频提示词改写读同一个变量（`packages/engine/src/providers/stepfun-llm.ts`、`apps/worker/src/generation/h3-prompt-writer.ts`），Web 不调用 StepFun。模型名已纳入 H3 缓存的 `input_hash`，换型号不会沿用旧缓存。

### 可用性验证（Spark，用现有密钥，当前计划端点 `/step_plan/v1`）

| 调用 | step-5-preview | step-3.5-flash |
| --- | --- | --- |
| 最小 JSON | 200，1.2 秒，JSON 有效 | 200，1.1 秒，JSON 有效 |
| 中等长度输出（约 1900 字符） | 200，20.7 秒，输出 1897 token，`finish=stop`，JSON 有效 | 200，31.6 秒，输出 5707 token，JSON 有效 |

均带 `response_format: json_object`。两个调用都远小于代码里硬编码的 60 秒超时。

### 变更

用 [`set-worker-env.py`](set-worker-env.py)：冻结 Web → 等待无待处理任务且无有效执行租约（最长 1000 秒）→ 停 Worker → 备份并只改一行 → 启动 Worker → 启动 Web。不打印值，保持 600 权限。

| 节点 | 备份文件（UTC） | 结果 |
| --- | --- | --- |
| Spark | `/home/Developer/.config/kelvoy/worker.env.before-20261011T032947Z` | Worker 进程环境 `STEPFUN_MODEL=step-5-preview`，服务 active、健康 `ok` |
| GX10 | `/home/huntun/.config/kelvoy/worker.env.before-20261011T033024Z` | 同上，切换时无在途任务 |

### 回退

删除 `worker.env` 中 `STEPFUN_MODEL` 一行（或用备份文件覆盖），用同一个脚本流程排空后重启 Worker。已写入的提示词记录保留，其 `model` 字段区分来源。

## 未验证与待跟进

- **真实 Worker 写入尚未被生产流量验证**：隔离验收覆盖读取、脱敏、隔离与删除，Worker→store 的写入链路由集成测试覆盖，但线上 `prompt_traces` 目前为 0 行。首次真实生成后应只读核对该表有行、`model` 为 `step-5-preview`。
- **H3 校验规则按 `step-3.5-flash` 的输出调出**，未在真实工作量上对 `step-5-preview` 验证。换型号后 `prompt_format_invalid` 的比例可能变化；应借助提示词记录按 `model` 对比通过率。
- **计价未复核**：`cost_usd` 记账与积分价格是否随型号变化尚未检查。
- 本次切换没有对 `step-5-preview` 在真实视频提示词改写负载下的稳定性做重复测量，只有上表的两组单次调用。
