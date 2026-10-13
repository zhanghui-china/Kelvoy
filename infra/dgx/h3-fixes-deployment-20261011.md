# H3 改写修复与 LLM 型号回退（2026-10-11）

由 GX10 上一期作品 `e_6d9f8b2c…`（7 镜，3 成功、4 失败）的排查引出：型号回退、参考图标签规范化、LLM 超时可配置。无数据库迁移，无前端改动，素材未备份也未触碰。

## 一、那期 7 镜的失败原因

4 个失败镜头全部死在"视频提示词改写"这一步（生成视频之前），用的是 `step-3.5-flash`：

| 镜头 | 结果 | 原因 |
| --- | --- | --- |
| 1、3、7 | 成功 | 改写 33–39 秒 |
| 2 | 失败 | 规则 `all supplied pictures must be referenced` |
| 4 | 失败 | 改写 60 秒超时，重试后再超时 |
| 5 | 失败 | 先超时，重试后触发 `subject role does not match supplied reference` |
| 6 | 失败 | `subject role does not match supplied reference` |

9 次调用：3 次成功、3 次超时、3 次规则失败。

## 二、重放与型号对照（GX10，真实代码路径，生产库只读，临时项目目录）

用这些镜头已存的上下文，经 `createH3PromptWriter` 重放，抓取模型原始输出：

| | step-3.5-flash | step-5-preview |
| --- | --- | --- |
| 调用数 | 11 | 14 |
| 成功 | 6（55%） | 1（7%） |
| 60 秒超时 | 1（9%） | 7（50%） |
| 校验规则失败 | 4 | 6 |

样本小且是之前失败过的难例，所以绝对成功率偏低，但两个型号用的是同一批镜头。重放中的规则失败形态：

| 规则 | 次数 | 结论 |
| --- | --- | --- |
| `all supplied pictures must be referenced` | 5（两个型号都有） | 已确认：模型把 `<Picture 1>` 写成不带尖括号的 `Picture 1` |
| `invalid visible retention syntax` | 2（flash） | 已做过一次格式纠正，纠正后仍错 |
| `preserve shot size and camera` | 1（flash） | 镜头 `detail`＋`push`，模型没写出要求的关键词 |
| `dialogue and text are not requested` | 2（step-5） | 触发词未抓到，推测与否定句清理的词表有关，**未确认** |
| `subject role does not match` | 线上 2 次，重放 0 次 | 此前"词表过窄"的推断**未被复现**，不应据此改动 |

## 三、变更

1. **型号回退**：两个节点 `STEPFUN_MODEL` 回到 `step-3.5-flash`（用 [`set-worker-env.py`](set-worker-env.py)，先排空再重启 Worker）。

   | 节点 | 备份（UTC） |
   | --- | --- |
   | GX10 | `/home/huntun/.config/kelvoy/worker.env.before-20261011T062726Z` |
   | Spark | `/home/Developer/.config/kelvoy/worker.env.before-20261011T062733Z` |

2. **参考图标签规范化**（`5bf1727`）：校验前把序号属于本次参考图、缺尖括号的 `Picture N` 机械改写为 `<Picture N>`；未提供的序号不动，所有语义规则不放宽。改动个数只出现在 trace 回调的 entry 里，没有持久化（store 没有对应列）。
3. **LLM 超时可配置**（`be9a28d`）：`KELVOY_LLM_TIMEOUT_SECONDS`，默认 120，整数 30–300，非法值抛错，Worker 启动即校验；脚本生成、分镜建议、H3 改写共用；诊断的 `budget_seconds` 反映真实值。它是**单个 HTTP 请求**的预算，纠正一轮会再发一次请求，本地重试最多两次。任务租约 90 秒、每 30 秒心跳续约，与请求时长无关。

## 四、发布

| 节点 | 发布目录 | 源码 | 数据库备份（UTC） | 切换 |
| --- | --- | --- | --- | --- |
| Spark | `~/kelvoy-releases/h3-fixes-20261011-549ed2b` | `549ed2b` | `/home/Developer/kelvoy-backups/pre-h3-fixes-20261011-20261011T063901Z` | 06:39 |
| GX10 | `~/kelvoy-releases/h3-fixes-20261011-549ed2b` | `549ed2b` | `/home/huntun/kelvoy-backups/pre-h3-fixes-20261011-20261011T064056Z` | 06:40 |

变更包 20 个代码文件（约 38KB），沿用"`cp -a` 当前发布目录＋覆盖"；无前端改动，`dist_stamp verify` 通过；闸门为严格相等（无新表）。节点上类型检查通过，engine／store／worker／web 1089 项测试 0 失败（1 项平台条件跳过），基础设施 Python 测试通过。切换后两节点服务 active、重启 0、健康检查 `ok`、近 3 分钟日志无错误，worker 环境为 `STEPFUN_MODEL=step-3.5-flash`。drop-in 新文件名自动比现有多一个前导 `z`（`zzzzzzzzzzzz-h3-fixes-20261011.conf`），排序正确。

## 五、未验证与待跟进

- 标签规范化与 120 秒超时是在重放数据的基础上做的推断性修复，**还没有被线上真实生成验证**。下次真实生成后应只读核对：`all supplied pictures must be referenced` 是否消失、超时占比、`prompt_traces` 里 `outcome`／`rule` 的分布。
- 仍然会失败的类别没有处理：纠正后仍错的 `invalid visible retention syntax`、`preserve shot size and camera`，以及疑似与否定句词表有关的 `dialogue and text are not requested`。建议拿到原文后再改，或评估是否允许一次定向纠正重试。
- 失败路径不保存模型响应（ADR-0012），诊断这类问题只能靠重放。
- ADR-0011 仍写"LLM 单次上限 60 秒"，未同步。
- 本次的型号结论来自单日小样本，不代表 `step-5-preview` 在其它负载下的表现。

## 回退

在对应节点删除 `kelvoy-{web,worker}.service.d/zzzzzzzzzzzz-h3-fixes-20261011.conf`，`daemon-reload` 后重启 Web／Worker，回到上一版（Spark 为 `prompt-traces-20261011-573aa90`，GX10 为 `prompt-traces-20261011-6946b27`）。不恢复数据库。

## 六、后续：校验器误判修复与保留说明放宽（同日，`d84f995`、`c107ebd`）

对上一节遗留的失败类别，用 GX10 同一批 4 个镜头（2/4/5/6）重放，抓取模型原文后逐个归因。结论：16 次失败里约 70% 是我们这一侧的规则或输入，没有一次能确认是模型答错。

### 归因（`step-3.5-flash`，新代码，24 次调用：8 通过、16 失败）

| 归属 | 次数 | 内容 |
| --- | --- | --- |
| 校验规则过严／写错 | 7 | 角色词表不认 `persona`（4）；否定句 `no … vocal sounds` 被当成有人声（2）；`close-up` 不被当成 `detail`（1） |
| 上游数据自相矛盾 | 4 | 脚本阶段把机位标成 `pan`，运动描述却是"仰拍"；机位枚举没有 tilt |
| 设计冲突 | 1 | 每镜强制带人物参考图，镜头里没人，模型写 `(absent)`，规范没有"不出现"的写法 |
| 未能判定 | 4 | 保留说明语法 2、`one continuous Shot 1` 1、景别机位 1，没抓到原文 |

### 修复

1. **角色规则**：只在整行只命中对方角色词表、且没命中己方词表时才失败；扩充词表（`persona`、`traveler`、`visitor` 等）；整行判断而不是只看到 `<Picture>` 为止。
2. **否定从句**：`removeNegativeConstraints` 改为整句剥离（到 `.` `;` 换行 `|` 或 `, but/while/then`，单句最多 12 词）。已知取舍：同一句里 "no sound effects, and she says hello" 的后半会被吃掉，因为该函数只用于禁止项检测，宁可少报。
3. **景别／机位**：`close` 与 `detail` 互通；`tilt/sweep/swing` 归入 `pan`；`push` 增加 `zoom in/approach`；静态机位不得运动的规则不变。
4. **脚本阶段自洽规则** `camera_motion_consistency`：保守词表，仅当运动描述恰好推断出一个镜头运动类别且与 `camera` 不同时才违规，反馈通过现有纠错循环发回脚本模型；仰拍／俯拍属 `pan`。
5. **保留说明放宽**（`c107ebd`）：Subject 条目括号内容不再强制 `appears in [Shot 1]`（允许 `does not appear in [Shot 1]`、`absent`、`appears in []`），官方规范允许的 `<Picture N>` 条目不再判错且不计数；Subject 编号必须与定义一一对应、不得重复，关系标记与 ` - ` 分隔仍严格。

### 重放对照（同批镜头，每轮 12 次）

| | 修复前 | 第 1、2 层修复后 | 再加保留说明放宽 |
| --- | --- | --- | --- |
| 通过 | 2 | 8 | **11** |
| 角色／景别机位／对白规则失败 | 8 | 0 | 0 |
| 保留说明语法失败 | 1 | 3 | 1（模型漏写了 Subject 2 一行，真失败） |
| 60 秒超时 | 0 | 0 | 0 |

样本小，且全是此前失败过的难例，绝对成功率只代表这批镜头；误差在 ±2 次内不视为变化。

### 一处更正

发布前我曾说"`retention_analysis` 只用于校验和缓存，不会进入视频内容"，**不对**：`renderSections` 会把 Ref2VA 的六个字段（含 `retention_analysis`）拼进最终发给视频模型的提示词。因此放宽之后视频模型可能看到 `(does not appear in [Shot 1])` 这类官方规范里没有的写法。语义准确，但对视频质量的影响**未测量**，只能靠人工审核片段观察。

### 发布

| 节点 | 发布目录 | 源码 | 数据库备份（UTC） | 切换 |
| --- | --- | --- | --- | --- |
| Spark | `validator-fixes-20261011-d84f995`，随后 `retention-tolerance-20261011-c107ebd` | `d84f995` → `c107ebd` | `…pre-validator-fixes-…T074741Z`；`…pre-retention-tolerance-…T080504Z` | 07:47；08:05 |
| GX10 | 同上 | 同上 | `…T074924Z`；`…T080549Z` | 07:49；08:05 |

无迁移、无前端改动；节点上 1119／1128 项测试 0 失败；两节点服务 active、重启 0、健康 `ok`、近 3 分钟日志无错误；`STEPFUN_MODEL` 仍为 `step-3.5-flash`。drop-in 新文件名自动比现有多一个前导 `z`。

回退：删除对应 drop-in（最新的 `…zzzzzzzzzzzzzz-retention-tolerance-20261011.conf`）后 `daemon-reload` 并重启，回到上一版；不恢复数据库。

### 仍待跟进

- 视频质量是否受保留说明新写法影响：待人工审核真实片段。
- 剩余少量失败：模型漏写 Subject 行、`timeline must end at …`、`one continuous Shot 1`，没有足够原文。可考虑对格式类失败允许一次自动再试（模型输出随机，现在是终止性失败）。
- 产品层面：是否对没有人的镜头不再带人物参考图（会改变视频直出的参考图策略）。
- ADR-0011 仍写"LLM 单次上限 60 秒"。

## 七、格式类失败自动重试一次（同日，`fe5b52b`）

H3 改写的格式／校验类失败原先是终止性的，镜头直接失败、退积分，等用户手动重试。重放中同一镜头同一输入 3 次里常常 2 次成功，所以改为与超时、网络错误一样走一次本地重试（`MAX_LOCAL_ATTEMPTS = 2`）：第一次失败重排队、积分仍预留，第二次仍失败才终止并退款。内容拦截和无效输入仍不重试。

- 改动：`errors.ts` 的 `classifyH3Failure` 里 `retryable: !blocked`；`consumer.ts` 去掉对 `H3FormatError` 的排除；PRD 一句同步。第一次失败的提示词记录照常落库，两次尝试在界面里都能看到。
- 整合时发现并修了子代理测试的两处写法问题（`ContentBlockedError` 误传字符串；`classifyH3Failure` 旧断言未更新），实现本身无需改。全量 1181 通过、0 失败。

| 节点 | 发布目录 | 数据库备份（UTC） | 切换 |
| --- | --- | --- | --- |
| Spark | `retry-once-20261011-fe5b52b` | `/home/Developer/kelvoy-backups/pre-retry-once-20261011-20261011T092507Z` | 09:25 |
| GX10 | `retry-once-20261011-fe5b52b` | `/home/huntun/kelvoy-backups/pre-retry-once-20261011-20261011T092732Z` | 09:27 |

本次发布由子代理按固定手册执行（Spark 全部满足期望才进入 GX10，失败即停、不自行回退）。我另行独立核对两节点：三个服务 active、重启 0、`WorkingDirectory` 指向新目录、健康 `ok`、`STEPFUN_MODEL=step-3.5-flash`、近 5 分钟日志无错误、发布目录里含该改动、变更包已清除。节点上测试 1129 通过、1 项平台条件跳过、0 失败。无迁移、无前端改动。

**未验证**：真实流量下重试是否降低了用户可见失败。下次真实生成后应只读核对 `prompt_traces` 中同一任务是否出现两次尝试（`attempt` 1、2）及第二次结果。

回退：删除 `zzzzzzzzzzzzzzz-retry-once-20261011.conf` 两个 drop-in，`daemon-reload` 后重启，回到 `retention-tolerance-20261011-c107ebd`；不恢复数据库。

## 八、无人镜头校验、运镜升降词、被拒原文记录（同日，`05753a6`）

起因：GX10 上真实用户作品 `e_0a0d9f4d…`（直出模式）第 2 镜失败（积分已退回）、第 3 镜两次尝试均失败。提示词记录首次有真实数据：第 2 镜两次分别死在 `rewrite must be English` 与 `all supplied pictures must be referenced`，第 3 镜两次均 `preserve shot size and camera`。同镜头同输入重放大多通过，说明是采样随机性撞上偏严规则，加上两类确定性根因：无人镜头仍被要求引用人物图；脚本里 `camera=push` 与"镜头缓慢向上抬升"自相矛盾而规则词表没覆盖。

### 变更（三个分支合并，主干 `05753a6`；验收脚本 `813f79b`）

1. **无人镜头不强制引用人物图**（A，`person_visible`）：分镜新增可选布尔字段，缺省视为 `true`，旧作品行为不变；脚本阶段由 LLM 输出，只存显式 `false`。为 `false` 的镜头仍把人物图作为 Picture 1 送入视频模型，只是 H3 校验不再要求提示词引用它；场景图必须引用、人物主体仍须定义、角色词汇匹配不变。分镜编辑界面**没有**该开关（此后已补：分镜编辑表单提供「画面中有人物」复选框，见 PRD §4 与 Web 端操作手册 6.2）。
2. **脚本阶段升降词**（B）：`camera_motion_consistency` 增加"镜头…抬升／升起／上升／升高／下降／降落／下移／上移""摇臂升降""升降镜头"，归 `pan`；必须紧跟"镜头"才计入，"灯火升起"之类写景物的说法不判。已知漏判：没有"镜头"二字或中间夹了副词表以外的词。
3. **失败时保存被拒的模型原文**（C）：新增加性表 `prompt_trace_rejections`（迁移 `prompt_traces_v2`），与 `prompt_traces` 同主键，仅在 H3 格式校验失败时保存最后一次被拒输出，64KB 截断，同一结算事务内写入；脱敏沿用参考图路径与哈希替换，仅作品所有者接口可读，不进分享、作品详情、日志与 `tasks.error`，随作品删除清理。这**放宽**了 ADR-0012 原"原始 LLM 响应不入库"的约定，已在 ADR 补充段落，用户已确认。

### 发布前门槛（GX10，发布目录 `h3-round2-20261011-05753a6`，来源 `813f79b`）

| 项 | 结果 |
| --- | --- |
| 变更包 | 29 个文件（含前端 `PromptVersions.tsx`），`RELEASE.json` 带 sha256 清单，节点上重建前端并 `dist_stamp stamp/verify` |
| 类型检查 | 5 个包全过 |
| 测试（节点上） | engine 304、store 163、worker 226（1 项平台条件跳过）、web 457，**0 失败** |
| 重放 A（`person_visible:false`，e_0a0d9f4d 第 2、3 镜各 4 次，仅调 LLM） | **8/8 通过**，`all supplied pictures must be referenced` 0 次；此前同镜头基线 3/3 与 2/3 |
| 重放（缺省 `person_visible`，有人镜头 3 次） | 3/3 通过，行为不变 |
| 迁移预演（生产库副本，两遍幂等） | 只新增 `prompt_trace_rejections`（0 行）、`idx_prompt_trace_rejections_episode`、自动索引与迁移 `prompt_traces_v2` |

重放耗时 17–73 秒，均在 120 秒预算内。Spark 的同一变更包同样通过类型检查、同一组测试（0 失败）与迁移预演（`prompt_trace_rejections` 0 行、`prompt_traces` 0 行）；未重复 LLM 重放。

### 发布

| 节点 | 发布目录 | 数据库备份（UTC） | 切换 |
| --- | --- | --- | --- |
| GX10 | `~/kelvoy-releases/h3-round2-20261011-05753a6` | `/home/huntun/kelvoy-backups/pre-h3-round2-20261011-20261011T104204Z` | 10:42 左右（由主 agent 执行并核对：17 项隔离验收全过，新表 0 行，服务正常） |
| Spark | 同上 | `/home/Developer/kelvoy-backups/pre-h3-round2-20261011-20261011T111756Z` | 11:17 左右（由主 agent 执行并核对：服务 active、重启 0、健康 ok、日志 0 错误、17 项隔离验收全过，新表 0 行，公网 :8063 返回 200） |

闸门：`--allow-new-table prompt_trace_rejections --allow-migration prompt_traces_v2 --expect-empty-new-table`。drop-in 新文件名自动比现有多一个前导 `z`。`STEPFUN_MODEL` 仍为 `step-3.5-flash`。

### 未验证与提醒

- 真实流量下 `person_visible` 的判断准确率没有实测：重放里字段是人工置为 `false`，脚本 LLM 是否会正确输出它要靠下次真实生成核对（提示词记录里查脚本轮次与镜头字段）。
- `prompt_trace_rejections` 的首次真实写入尚未被生产流量验证。
- 视频质量是否受"人物不入镜"改写指令影响未测量。
- **GX10 磁盘 97%（约 29GB 可用）**，每个发布目录约 140MB（含 `node_modules`）；后续发布前应清理旧发布目录，否则 `cp -a` 与 DB 备份可能写满盘。
- 需 Web 与 Worker 同版本：Web 的 schema 校验必须接受新字段，否则带 `person_visible` 的分镜会被拒。

### 回退

在对应节点删除 `kelvoy-{web,worker}.service.d/` 下本次新建的 `…-h3-round2-20261011.conf`（文件名比 `zzzzzzzzzzzzzzz-retry-once-20261011.conf` 多一个前导 `z`），`daemon-reload` 后重启 Web／Worker，回到 `retry-once-20261011-fe5b52b`。新表与迁移记录保留，旧版本忽略它；**不恢复数据库**，避免覆盖上线后的新数据；备份仅用于核对和人工恢复。

## 九、新建界面默认关键帧（仅前端，GX10，2026-10-11）

分支 `feat/default-keyframe-ui`（未合并 main），提交 `4ee2729`，基线 `813f79b`。只改 `apps/web/src/frontend` 下 15 个文件，服务端、engine、worker、store 零改动，无迁移。

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/keyframe-default-20261011-4ee2729` |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-keyframe-default-20261011-20261011T115859Z` |
| 切换 | 11:59 左右，`deploy-web-worker.py` 状态 `deployed`，未带迁移闸门参数 |
| 节点验证 | typecheck 5 包通过；web 463 通过 / 0 失败 |
| 切换后 | 三服务 active、重启 0、健康 `ok`、近 3 分钟日志 0 错误、`STEPFUN_MODEL` 仍为 `step-3.5-flash`、无进行中任务、线上前端包含新文案 |

Spark 未发布。未做的验证：浏览器走查（新建页默认值、选图界面、直出提示行）。回退：删除 `zzzzzzzzzzzzzzzzz-keyframe-default-20261011.conf`（web 与 worker 各一份），`daemon-reload` 后重启 web / worker，回到 `h3-round2-20261011-05753a6`。

## 十、失败镜头重试入口（GX10，2026-10-11）

决策见 ADR-0014，接口见 `docs/api/retry.md`。

- 改动：`packages/store`（`listRetryableFailedTasks`、`submitFailedTaskRetry` 增加 `shot_no`／`all`／补发）、`apps/web` 路由（`/retry` 参数校验、详情 `failed_tasks`）、前端失败卡片与进度区按钮。
- 验证：`make typecheck && make test` 通过（1229 pass / 0 fail）；`all` 批量入队、余额不足零副作用、无任务记录补发均有 store 层测试。尚未在生产数据上验证。
- 发布要求：无数据库迁移，不需要迁移闸门标志；Web 与 Worker 同版本；先 GX10 后 Spark，先排空任务。
- 2026-10-11 已把本分支合并进 `feat/default-keyframe-ui`，作为 GX10 的一个发布（含默认关键帧前端）；Spark 尚未发布，也未合并 main。
- 回退：切回上一发布目录（删除新增 drop-in，`daemon-reload` 后重启）。不恢复数据库；已入队的重试任务由旧版本按原逻辑消费。

### 发布（GX10）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/keyframe-retry-20261011-5f9b5fa`（基于 `keyframe-default-20261011-4ee2729`，覆盖 18 个文件，`RELEASE.json` 带 sha256 清单） |
| 源码 | `feat/default-keyframe-ui@5f9b5fa`（已合并 `fix/retry-buttons`），未合并 main |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-keyframe-retry-20261011-20261011T130357Z` |
| 切换 | 13:04 左右，`deploy-web-worker.py` 状态 `deployed`，无迁移闸门参数；drop-in `zzzzzzzzzzzzzzzzzz-keyframe-retry-20261011.conf` |
| 节点验证 | 类型检查 5 包通过；测试 1234 通过 / 1 平台条件跳过 / 0 失败；前端重建并 `dist_stamp verify` 通过 |
| 切换后 | web／worker 为 user unit，均 active、重启 0；健康 `ok`；worker 工作目录指向新发布；近 6 分钟日志 0 错误；线上前端包为新构建 `index-BxZ9JTvP.js` |

组装时的坑：macOS `tar` 会把 `._*` AppleDouble 文件带进发布目录，被 `bun test` 当成测试文件读到，造成 6 个"失败"。已在节点上清掉；以后用 `COPYFILE_DISABLE=1 tar` 或 `rsync`。

未验证：真实失败镜头上点"重试这一镜"／"重试全部"的端到端表现；浏览器走查。Spark 未发布。回退：删除 web 与 worker 各一份 `zzzzzzzzzzzzzzzzzz-keyframe-retry-20261011.conf`，`daemon-reload` 后重启，回到 `keyframe-default-20261011-4ee2729`。

## 十一、I2VA 提示词校验误杀修复（GX10，2026-10-11）

触发：GX10 关键帧模式作品 `e_5cc656f2` 第 6 镜视频任务两次尝试均被 H3 校验拒绝（`timeline must end at 00:04.000`、`one continuous Shot 1 required`）；同作品 I2VA 10 次改写 4 次被拒，其中 3 次是同一回声。

- 根因：worker 自己拼进的官方首帧句含 `(from [Shot 1])`，模型回声后被校验器数成第二个 `[Shot 1]`。
- 改动（仅 `apps/worker/src/generation/`，3 个文件）：计数前去掉该来源标注（真实 `[Shot N]` 仍终止）；`[Shot 1]` 重复／缺失与"时间线完全没有时间戳"两类纯格式失败给一次纠正；带错误时间戳仍终止；提示词点明首帧句由 worker 添加、时间线需写 `00:0N.000`。
- 回放（真实被拒输出，不调 LLM）：回声类 2 条直接通过；第 6 镜两次均只剩"缺结束时间戳"，走一次纠正。能否救回取决于模型。

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/i2va-format-20261011-ea11290`（基于 `keyframe-retry-20261011-5f9b5fa`，覆盖 3 个文件） |
| 源码 | `feat/default-keyframe-ui@ea11290` |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-i2va-format-20261011-20261011T223622Z` |
| 切换 | 22:36 左右，`deploy-web-worker.py` 状态 `deployed`，无迁移 |
| 节点验证 | 类型检查 5 包通过；测试 1237 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker active、重启 0、健康 `ok`、近 4 分钟日志 0 错误、worker 工作目录为新发布、无进行中任务 |

注意：节点上跑测试必须带 `PATH=$HOME/.bun/bin:$HOME/.local/bin:$PATH`；缺 `~/.local/bin` 时用到 `/usr/local/bin/ffmpeg`，22 个合成测试会失败（环境问题，与代码无关）。

未验证：第 6 镜尚未重试；纠正通道在真实 LLM 上的命中率未测。Spark 未发布。回退：删除 `zzzzzzzzzzzzzzzzzzz-i2va-format-20261011.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `keyframe-retry-20261011-5f9b5fa`。

## 十二、GX10：关键帧候选改用序号标识（2026-10-12）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/kf-candidate-labels-20261012-3bf01aa`（基于 `i2va-format-20261011-ea11290`，覆盖 4 个前端文件，仅前端） |
| 源码 | `feat/default-keyframe-ui@3bf01aa` |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-kf-candidate-labels-20261012-20261012T004156Z` |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过；类型检查 5 包通过；测试 1238 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker active、重启 0、健康 `ok`、线上首页引用的 JS 与发布目录构建产物一致（`index-oPsO2wJA.js`） |

未做：浏览器目视（桌面与窄屏）。Spark 未发布。回退：删除 drop-in `…-kf-candidate-labels-20261012.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `i2va-format-20261011-ea11290`。

## 十三、GX10：关键帧候选看大图（2026-10-12）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/kf-lightbox-20261012-aeca7d1`（基于 `kf-candidate-labels-20261012-3bf01aa`，覆盖 6 个前端文件，仅前端） |
| 源码 | `feat/default-keyframe-ui@aeca7d1` |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-kf-lightbox-20261012-20261012T013147Z` |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过；类型检查 5 包通过；测试 1243 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker active、重启 0、健康 `ok`、线上首页引用的 JS 与构建产物一致（`index-DNkXdBbs.js`） |

未做：真实浏览器交互验证（`showModal`、Esc、焦点回到触发按钮、窄屏全屏）。Spark 未发布。回退：删除 drop-in `…-kf-lightbox-20261012.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `kf-candidate-labels-20261012-3bf01aa`。

## 十四、GX10：关键帧参考图规则收口并在审核页展示（2026-10-12）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/kf-refs-20261012-9d0d7be`（基于 `kf-lightbox-20261012-aeca7d1`，覆盖 engine 与前端共 7 个文件含测试，无迁移） |
| 源码 | `feat/default-keyframe-ui@9d0d7be` |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-kf-refs-20261012-20261012T020655Z` |
| 变更 | 新增 `keyframeReferences()`，`runKeyframe` 与审核页共用；行为与原先等价（角色第 1 张 + 地标第 1 张） |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过；类型检查 5 包通过；测试 1250 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker active、重启 0、健康 `ok`、近 4 分钟日志 0 条 error、worker 工作目录为新发布、线上 JS 为 `index-TupfmbcR.js` |

未做：真实浏览器目视；切换前未单独核对进行中任务数（直接用 `deploy-web-worker.py` 的排空逻辑）。Spark 未发布。回退：删除 drop-in `…-kf-refs-20261012.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `kf-lightbox-20261012-aeca7d1`。

## 十五、GX10：角色穿搭（2026-10-12）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/persona-outfits-20261012-8b597e7`（基于 `kf-refs-20261012-9d0d7be`，覆盖 schema／store／engine／web 服务端与前端，无数据库迁移） |
| 源码 | `feat/default-keyframe-ui@8b597e7`（ADR-0015） |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-persona-outfits-20261012-8b597e7-20261012T053316Z` |
| 变更 | `Persona.outfits` 与 `brief.outfit_id`（可缺省，老数据零迁移）；`/api/personas/:id/outfits[...]`；选中穿搭的第 1 张图替代角色第 1 张参考图用于关键帧与直出视频；角色页穿搭区块、新建作品选穿搭 |
| 切换前 | 无排队／运行中任务；磁盘 28G 可用（97%） |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过；类型检查 5 包通过；测试 1285 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker／inference active、重启 0、健康 `ok`、web 工作目录为新发布、线上 JS 为 `index-B0fL6dVU.js` 且含穿搭代码、未登录 POST outfits 返回 401、近 3 分钟日志 0 条 error |

未做：真实浏览器交互验证（新建作品页季节自动选中与换角色重置）；真实穿搭照的脸漂风险未测（实验素材为模型生成）；A 方案姿态偏僵与背景噪点待用真实 `kf_prompt` 复核。Spark 未发布。回退：删除 drop-in `…-persona-outfits-20261012-8b597e7.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `kf-refs-20261012-9d0d7be`；已写入的 `outfits` 字段旧代码会忽略。

## 十六、GX10：人物镜头的构图与朝向（2026-10-12）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/person-orientation-20261012-5f278b7`（基于 `persona-outfits-20261012-8b597e7`，覆盖 engine／worker／web 共 12 个文件含测试，无迁移） |
| 源码 | `feat/default-keyframe-ui@5f278b7`（ADR-0016） |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-person-orientation-20261012-5f278b7-20261012T071038Z` |
| 变更 | 脚本提示词新增人物镜头构图与朝向规则；关键帧提示词命名图1/图2；空镜且有地标图时不传角色参考图；H3 改写约束保持朝向与地标锚点，`WRITER_VERSION` 升到 `h3-writer-v2`；审核页空镜文案；角色编辑页参考图提示 |
| 切换前 | 无排队／运行中任务；磁盘 28G 可用（97%） |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过；类型检查 5 包通过；测试 1295 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker／inference active、重启 0、健康 `ok`、web 与 worker 工作目录均为新发布、线上 JS 为 `index-CRL6DOtK.js`、近 3 分钟日志 0 条 error |

未做：新脚本与关键帧的真实端到端验证（灵山大佛关键帧模式一期、直出模式一期）；H3 视频层未实测；真实浏览器目视。影响范围：只影响之后新生成的脚本与关键帧，已有作品不变；已有脚本重新生成才会用新规则。Spark 未发布。回退：删除 drop-in `…-person-orientation-20261012-5f278b7.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `persona-outfits-20261012-8b597e7`。

## 十七、GX10：朝向发布后的回归修复与脚本规则补强（2026-10-12）

十六节发布后用专用验证账号 `verify_orient`（GX10，300 积分）在灵山大佛上各跑一期关键帧模式与直出模式，发现并修复两处问题。

| 发布 | 目录／源码 | 备份（UTC） | 变更 |
| --- | --- | --- | --- |
| v3 改写 | `~/kelvoy-releases/h3-writer-v3-20261012-a562f25`／`a562f25` | `pre-h3-writer-v3-20261012-a562f25-20261012T082933Z` | `h3-writer-v2` 的朝向与地标句让模型丢掉景别与运镜词，改写被 `preserve shot size and camera` 拒绝 7/8（v1 为 2/54），直出期 7 镜失败 4 镜；v3 在同处显式要求写出景别与运镜词，`WRITER_VERSION` 升到 `h3-writer-v3` |
| 脚本规则 | `~/kelvoy-releases/script-orient-rules-20261012-ac47bb0`／`ac47bb0` | `pre-script-orient-rules-20261012-ac47bb0-20261012T09130…` | 朝向必须写成「背对镜头／侧对镜头／正对镜头」；第一镜必须填主地标并点名 |

验证结果：v3 后 4 次改写全部一次通过，直出期 7 镜出片、首帧与大佛有关；规则上线后关键帧期 7 镜脚本全部写明朝向，第 1、2、3、4、7 镜背对或侧对且大佛清晰。两发布均无迁移，服务 active、重启 0、health ok。

已知遗留：无地标的人物镜头（室内参观、吃小笼）只传角色参考图，仍会继承参考图的自拍构图并可能生成无关背景；决定不改代码，靠角色编辑页与手册对"第一张参考图用全身站姿"的提示。Spark 未发布。验证账号与三期验证作品仍在 GX10。

## 十八、Spark：补齐穿搭、朝向与脚本规则（2026-10-12）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/person-outfits-orient-20261012-ac47bb0`（基于 `h3-round2-20261011-05753a6`，覆盖 74 个文件，无数据库迁移） |
| 源码 | `feat/default-keyframe-ui@ac47bb0`（ADR-0015、ADR-0016；含 `h3-writer-v3` 与脚本朝向规则） |
| 数据库备份（UTC） | `/home/Developer/kelvoy-backups/pre-person-outfits-orient-20261012-ac47bb0-20261012T140557Z` |
| 切换前 | 无排队／运行中任务；磁盘 1.6T 可用（55%） |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过（线上 JS 为 `index-CRL6DOtK.js`）；类型检查 5 包通过；测试 1295 通过 / 1 跳过 / 0 失败 |
| 切换后 | web／worker／inference active、重启 0、健康 `ok`、web 工作目录为新发布、近 3 分钟日志 0 条 error |

未做：Spark 上没有建作品做端到端验证（验证只在 GX10 做过）。回退：部署脚本已自动备份；需要时删除 drop-in `…-person-outfits-orient-20261012-ac47bb0.conf`（web 与 worker 各一份），`daemon-reload` 后重启，回到 `h3-round2-20261011-05753a6`；已写入的 `outfits` 字段旧代码会忽略。

## 十九、GX10：穿搭三视图（2026-10-13）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/three-views-20261013-5335b9c`（基于 `person-orientation` 之后的线上版本，以节点 worker 的 `RELEASE.json` 为基线） |
| 源码 | `main@5335b9c`（ADR-0017） |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-three-views-20261013-5335b9c-20261013T114205Z` |
| 迁移 | 加性：新表 `persona_asset_jobs`、迁移 id `persona_asset_jobs_v1`；闸门参数 `--allow-new-table persona_asset_jobs --allow-migration persona_asset_jobs_v1 --expect-empty-new-table`，`rehearse-migration.py` 在生产库副本上两遍幂等 |
| 变更 | 穿搭三视图生成（`sharp` 0.35.5 拼图、直出视频照片兜底）；未就绪的三视图穿搭拒绝建作品（409 `outfit_not_ready`） |
| 切换后 | web／worker／inference active、重启 0、健康 `ok`；迁移表共 5 项（含 `persona_asset_jobs_v1`） |

发布中踩到的坑（已固化进 `release-gx10.sh`，见第二十节）：
- 非交互 SSH 的 `PATH` 没有 bun，且 `bun … | tail` 在无 `pipefail` 时吞掉失败，导致首次包里的前端未重建；重建后重新 `dist_stamp`。
- 打包的 `RELEASE.json` 缺 `commit` 字段，`deploy-web-worker.py` 在停服务前读它，`KeyError` 中止；已在节点补字段，并删除那次留下的空备份目录 `…T113951Z`，再重新部署成功。
- 判断迁移是否生效不能只看排序后的最后两项，要核对完整列表。

未做：真实三视图生成的端到端验证（真实照片的脸漂、拼图观感）。Spark 未发布，仍在 `ac47bb0`。回退：删除 `kelvoy-{web,worker}.service.d/` 下含 `three-views-20261013-5335b9c` 的 drop-in，`daemon-reload` 后重启 web、worker；新表与迁移记录保留，旧代码不使用。

## 二十、GX10：地标表单填写说明与一键发布脚本（2026-10-13）

| 项 | 内容 |
| --- | --- |
| 发布目录 | `~/kelvoy-releases/landmark-hints-20261013-9f4f88f`（基线 `5335b9c`，3 个提交，9 个文件，无删除，无迁移） |
| 源码 | `main@9f4f88f`（`d3bb6c7` 地标表单、`a019cce` 发布脚本、`9f4f88f` 脚本修复） |
| 数据库备份（UTC） | `/home/huntun/kelvoy-backups/pre-landmark-hints-20261013-9f4f88f-20261013T121410Z` |
| 变更 | 目的地草稿编辑页「最佳机位／时段」「必须保真的特征」补说明、占位示例、折叠的填写指南、按类型的时段候选（点击才追加，不预填）；「发布准备」缺项可点击定位；纯前端，文案明确 `best_time` 不影响生成画面 |
| 切换前 | 无排队／运行中任务；节点根分区 97%（约 27G 可用） |
| 节点验证 | 前端重建并 `dist_stamp stamp/verify` 通过；类型检查 5 包通过；测试 1377 通过 / 1 跳过 / 0 失败（本机 1378 通过） |
| 切换后 | web／worker／inference active、重启 0；web、worker 工作目录为新发布，inference 仍为 `video-fix-20261010-v2`；健康 `ok`；线上 JS `index-01MamCpV.js`；近 3 分钟日志 0 条 error；迁移表 5 项不变 |

发布方式：首次使用 `infra/dgx/release-gx10.sh landmark-hints prepare`，再 `switch`（分阶段，切换前需手输 `yes`）。该脚本固化第十九节的坑：显式 `PATH`、`pipefail`、`RELEASE.json` 带 `commit`、`COPYFILE_DISABLE`、基线取节点正在运行的 `RELEASE.json`、前端节点上重建并 `dist_stamp`、`schema.ts` 有改动时强制要求迁移闸门参数。首跑暴露一个脚本缺陷：`$VAR` 紧跟全角标点时被 bash 并入变量名（`unbound variable`），`9f4f88f` 改为 `${VAR}`。

未做：真实浏览器目视（说明与占位、候选追加、缺项定位、角色页 1–7 提示）；时段候选文案待产品审定。Spark 未发布。磁盘提醒：每次发布 `cp -a` 一份发布目录，节点根分区已 97%，需清理旧发布目录。回退：删除含 `landmark-hints-20261013-9f4f88f` 的 drop-in，`daemon-reload` 后重启 web、worker，回到 `three-views-20261013-5335b9c`；无迁移，无需动数据库。
