# Kelvoy 代码审计台账（持续更新）

基线：`848b4a86bc3683490bd15229b69a4c1d128840e4`（`codex/reference-design-alignment`）。修复分支：`codex/code-audit-remediation`。评估条件：单机 DGX、SQLite、团队使用、至多 1000 期，每期约 30 镜。此文档记录已核实的证据和未完成的验证；测试通过不等于全系统审计完成。

## 覆盖矩阵

| 文件组 | 覆盖状态 | 方法及边界 |
| --- | --- | --- |
| `packages/engine/src/{schema,state,rules,stages,providers,templates}` | 已静态审查 | 检查领域入口、状态转换、审核、生成参数；仍需真实模型响应验证 |
| `packages/store/src` | 已静态审查 | 检查 SQLite 模式、读写、任务、积分、历史兼容；旧数据库迁移和故障注入待扩充 |
| `apps/worker/src` | 已静态审查 | 检查队列、推理适配、合成、文件发布；并发执行和崩溃边界待扩充 |
| `packages/cli/src` | 已静态审查 | 检查导入与阶段运行；部署脚本未纳入此组 |
| `services/inference/src`、`tests` | 已静态审查 | 检查 HTTP、ComfyUI 提交/轮询、超时、媒体处理；未连真实 DGX |
| 四份生产使用的 `comfyui-bridge/*_api.json` | 已做静态图检查 | 链接完整性已入测试；节点版本和模型文件存在性待真机核对。其他示例工作流不参与当前生产调用，暂排除 |
| `apps/web/src/server` | 已重点审查，余下待逐文件复核 | 已核对认证、模板、期、分享、素材；需完成上传和全部写路由的输入/对象权限矩阵 |
| `apps/web/src/frontend` | 已重点审查，余下待逐文件复核 | 已核对首页、作品、用量、审片异步状态；需逐组件核对请求乱序、轮询、上传恢复 |
| `scripts`、`infra`、`.github/workflows` | 已静态审查 | 运行依赖、路径、CI 触发已检查；部署和真机健康检查待验证 |
| `docs`、历史 Flask 脚本、非生产 ComfyUI 示例图 | 非生产路径 | 仅作契约/迁移依据；不将历史代码缺陷计为当前生产故障 |

跨模块链路：建期→授权→预留积分→队列；脚本审核→资源预留→生成；生成→租约→文件→DB 提交；失败→退款→重试；合成→成片→分享；历史角色/目的地版本→复现。前三条完成代码走读和部分回归，其余仍需故障注入和真机验收。

## 已确认问题与处理状态

每行的“证据”均是可重现路径或代码位置；未完成项不能按修复计。

| ID/状态 | 触发、影响、证据与根因 | 修正方向和回归 |
| --- | --- | --- |
| A1 已修复 | 模板创建带额外 `template_id`/`owner_id` 可覆盖服务端身份甚至覆盖已有官方模板；`apps/web/src/server/routes/templates.ts`、`packages/engine/src/schema/validate-catalog.ts`、`packages/store/src/templates.ts`。根因是输入透传和创建使用 upsert。| 显式 DTO + insert；未知字段/身份覆盖/重复 ID 回归测试。 |
| A2 已修复 | 建期可引用别人的私有模板；`apps/web/src/server/routes/episodes.ts` 查询后未核 owner。根因是存在性代替授权。| 同时允许官方或本人模板，跨账号回归测试。 |
| B1 部分修复 | 默认 `video_source=references` 的双参考图工作流缺模型与 CLIP 连线，含隐式节点；`comfyui-bridge/2_2_DualRef2Video_MinimaxH3_api.json`。静态图无法自洽。| 已改显式图、保留原 `BlockSparseAttention` 采样链，并对四份生产图做链接/可达性测试；目标 DGX 节点契约、该加速节点稳定性和两种画幅仍待验证。 |
| C1 部分修复 | 模型运行期间选择另一镜导致整期行版本变化，提交冲突耗尽重试、镜头停留生成中；`packages/store/src/charged-tasks.ts`、`apps/worker/src/queue/consumer.ts`。根因是整期替换与无关用户编辑争锁。| 已按目标镜合并；store 与 worker 并发回归证明另一镜选择保留，同镜改稿后的过时结果被拒绝，审核态可实际提交重试，写入冲突不消耗模型失败预算。旧 JSON 默认字段与事务读用同一解码器。执行令牌与租约回收仍待补。 |
| C2 部分修复 | 任务失败/退款后另起写入更新镜头和原因，中间崩溃会分裂状态；`apps/worker/src/queue/consumer.ts`。| 终态失败已在 store 事务内完成任务、退款、镜头/期失败和原因；需要崩溃注入覆盖各提交边界、脚本动作和取消。 |
| C3 已修复 | brief 可从 `script_review` 再运行并错误推进；`packages/engine/src/stages/index.ts`。根因是只检查状态机可推进，未检查阶段的起点。| 阶段入口表约束，反向阶段测试。 |
| C7 已修复 | CLI 将任意阶段字符串强转为 `StageName`，或从错误阶段运行时，异常分支可能把仍可正常推进的期标成失败；`packages/cli/src/run-stage.ts`。| 在执行前检查阶段名称和入口状态；错误命令不写库回归。 |
| C8 部分修复 | 完整期校验拒绝正常的自动配乐空键，却接受重复镜号、重复场景 ID 和悬空场景引用；`packages/engine/src/schema/validate.ts`。| 已统一空配乐语义（精确空串可用、空白路径不可用）并补跨字段身份/引用校验与 PRD；脚本审核入口仍需统一复用领域约束。 |
| S1 部分修复 | 合成共享素材 key 可通过 `../` 或符号链接逃出项目目录，进而让 ffmpeg 读取外部文件；`apps/worker/src/storage/artifacts.ts`。| 共享与期专属产物均已拒绝路径穿越、非法期 ID、已有符号链接逃逸；文件系统检查与使用之间的竞争窗口仍待更强隔离。 |
| U1 部分修复 | 两个并发角色参考图上传都从旧 `refs` 计算上限，并把旧数组整块写回；结果可能都返回成功、只留下最后一组引用，另有孤儿文件；`apps/web/src/server/routes/personas.ts`。| 已在 store 事务内读取最新版本并追加，超限时清理本次文件；并发上传回归通过。接收体积的流式上限和写盘/DB 崩溃恢复仍待完成。 |
| P1 部分修复 | `listEpisodes` 把所有整期 JSON 和 30 镜数据发给每个页面；`packages/store/src/episodes.ts`、`apps/web/src/server/routes/episodes.ts`、首页/作品/用量。根因是把详情模型作列表契约。| 首页和作品页已切换概览 DTO；1000 期响应从约 10.8 MB 降至 296 KB。用量页仍全量传输，分页与服务端聚合待完成。 |
| C4 部分修复 | 租约失效/取消未贯穿 HTTP、ComfyUI、ffmpeg；失权任务可能继续耗 GPU，路径也未由执行令牌隔离；`consumer.ts`、`inference/comfyui.py`、`storage/artifacts.ts`。| 续租、结果提交、失败终态和写冲突回队已要求未过期的相同执行令牌；过期未被回收前也不能提交或结算。仍需 AbortSignal 与期限贯通、执行隔离暂存、不可变发布、运行中取消和故障注入。 |
| C5 部分修复 | 目的地只保存当前文档，历史期有版本号却读不到对应版本；`packages/store/src/destinations.ts`、`apps/worker/src/queue/consumer.ts`。| 已保存不可变版本、阻止同版改写，Worker、CLI、审片台按期内版本读取；旧库缺失版本迁移为带近似标记的快照，审片台明确提示。需在真实旧生产库验收模型输入与分享行为。 |
| C6 部分修复 | 编辑脚本后，审核推进未必重新执行完整 FR-02 规则；`episode-review.ts`、`charged-tasks.ts`。| 事务性审核推进现按期内目的地版本重查脚本结构规则；关键帧选择和片段批准前置条件由共享领域函数供路由与事务使用。已测试绕开路由直接调 store 的非法推进；内容规则、编辑命令的一致性仍待复核。 |
| P2 部分修复 | 每次 DB 打开扫描并补 persona 历史，1000 期启动成本随数据增长；`packages/store/src/db.ts`。| persona 与 destination 历史回填已用 `schema_migrations` 限制为一次，旧库重复打开回归通过；部署旧生产库时仍需备份和验收实际迁移耗时。 |
| P3 部分修复 | 失败任务查询、队列扫描、跨期浏览器聚合有结构性放大；`packages/store/src/tasks.ts`、`apps/web/src/frontend/pages/UsagePage.tsx`。| 队列领取与失败摘要均已补索引，失败摘要改为单次 SQL 反连接；用量页全量聚合、分页和真实并发仍待修。 |
| R1 部分修复 | 媒体使用整文件缓冲、多份拷贝且暂存未统一回收；`services/inference/src/inference/comfyui.py` 和 worker 生成适配。| ComfyUI 下载已改流式、512 MiB 上限和原子临时文件清理，超限回归通过；Worker 归档后的中间副本、损坏媒体检查和目录回收仍待修。 |
| R4 部分修复 | ComfyUI 坏响应、落盘异常发生在提交后时原代码可能不发取消；取消 HTTP 失败也被忽略；`services/inference/src/inference/comfyui.py`。| 已对坏响应和 I/O 错误尝试按任务 ID 取消、检查 HTTP/确认位并记录失败，坏响应、取消 500 与合法非对象响应回归通过；断连、硬期限和目标 DGX 取消语义仍待验。 |
| R2 部分修复 | 合成文本降级依赖系统 `python3` + 未声明的 Pillow；`apps/worker/src/compose/ffmpeg.ts`、`scripts/render-text-overlays.py`。| 已锁定 Pillow 并让 Worker 使用项目受管理解释器，CI 检查依赖，macOS 无 ASS/drawtext 合成回归通过；DGX 字体和正式部署预检待验。 |
| R3 部分修复 | 模板/脚本改动不触发推理 CI，Python lint 原有两项失败；`.github/workflows/inference-ci.yml`。| 已扩展触发路径并修 lint；需 CI 实际运行确认。 |

待验证能力缺口：`/llm`、`/upscale` 501；不能以“不符合第一性原理”直接判错。模型/PRD 冲突必须按具体产品条款及替代关系逐项裁决。已有兼容处理若保护历史数据，应保留来源和移除条件。

## 工作包顺序与完成条件

1. 完成 Web 文件级覆盖；复核 A 类所有写入与嵌套字段，补上传事务/并发测试。
2. 在目标 ComfyUI 核对四份工作流节点、横竖画幅、失败和取消；静态通过不替代此项。
3. 完成 C 类执行令牌、租约、取消、隔离产物、不可变发布，再补目的地版本与审核领域命令；故障注入证明任务/积分/产物一致。
4. 以 `scripts/benchmark-episode-list.ts` 为本机 SQLite 基线，补单/5 浏览器与 1/2 Worker 的端到端指标，然后改分页、投影、聚合和队列查询。
5. 清理被替换内部路径、做一次性迁移和部署依赖；同步 PRD/ADR，验证旧库、分享和成片访问。

本分支可在各批独立提交，但合入主分支前须复核当前主工作区的三项已修改与四项未跟踪文件，旧接入计划不可覆盖新分支。真实 DGX 验收必须单列记录，覆盖两条生成路径、横竖画幅、失败恢复、取消和成片规格。

## 迁移与真机验收清单

以下项目尚未在目标环境执行，验收时逐项记录结果、时间、日志和数据库/产物样本：

- [ ] 备份生产 SQLite 与 `projects` 目录；记录迁移前每张表行数和数据库文件大小。
- [ ] 在副本上首次启动并复启，确认 `schema_migrations` 只记录一次目录版本回填；抽样核对历史角色/目的地快照，缺失旧版须标记 `compatibility_approximation=1` 且审片台显示提示。
- [ ] 复核旧分享链接及成片下载可访问，已批准成片和旧缓存未被清理；回滚仅使用备份，不把近似快照写回为精确历史。
- [ ] 在目标 ComfyUI `/object_info` 核对四份生产工作流所需节点、输入名与模型文件，并分别运行默认双参考视频与关键帧视频的 9:16/16:9 路径。
- [ ] 排队和采样阶段分别取消，验证只终止目标任务；覆盖租约回收、HTTP 断线、取消 404/500、推理超时及 Worker 重启。
- [ ] 验证 1080×1920、1920×1080、30 fps、字幕/中文字体、AI 标识、成片元数据和分享预览；分别检查 ASS、drawtext、Pillow 路径。
- [ ] 记录 10/100/1000 期、单/5 活跃浏览器、1/2 Worker 的 API p50/p95、响应字节、SQLite 写锁、队列等待、长任务、内存与 GPU 时间；与本地合成基线区分。

## 性能基线与局部对照

命令：`bun scripts/benchmark-episode-list.ts`。macOS arm64、Bun 1.4.2、内存 SQLite，预热一次、后续五次取中位数；每期 30 镜，单浏览器等价 JSON 序列化，不含网络/React/GPU。查询计划：`SCAN episodes USING INDEX sqlite_autoindex_episodes_1`。结果会随机器而变，不能代表 DGX。

| 期/镜 | 列表读取中位数 | JSON 字节 | 进程 heap used（该步结束） |
| ---: | ---: | ---: | ---: |
| 10 / 300 | 0.08 ms | 107,174 | 1.9 MB |
| 100 / 3,000 | 0.97 ms | 1,074,314 | 6.8 MB |
| 1000 / 30,000 | 9.35 ms | 10,773,614 | 96.6 MB |

该负载下主要可见问题是整期数据传输与前端重复解析；5 个浏览器和 1/2 Worker 的排队、写锁、长任务尚未量测，不能据此断言推理性能。

首页/作品概览接口修复后，同脚本的 1000 期单次响应为 **295,914 字节**（较整期减少 97.3%）；概览读取中位数 **18.12 ms**，高于原整期读取约 9.6 ms，因为 SQLite JSON 字段提取需要额外计算。此处优化的是网络和浏览器序列化/解析负担；服务端查询与内存仍要继续测量、改进。用量页尚未切换，故不可把 97.3% 写成全站改善。

队列基线使用 `bun scripts/benchmark-task-queue.ts`，内存 SQLite 中只留一个 pending 任务、其余为 done；101 次查询，首轮预热，分别记录中位数和 p95。修复前全表扫描并用临时 B-tree 排序；修复后索引排除历史 done 行，仍有很小的候选排序。此测试量的是领取查询，不含真实 Worker 排队或写锁。

| 历史任务 | 修复前中位/p95 | 修复后中位/p95 |
| ---: | ---: | ---: |
| 1,000 | 0.040 / 0.042 ms | 0.004 / 0.006 ms |
| 10,000 | 0.349 / 0.407 ms | 0.004 / 0.007 ms |
| 100,000 | 3.566 / 4.051 ms | 0.005 / 0.006 ms |

失败摘要基准：`bun scripts/benchmark-failed-task.ts`，同机内存 SQLite，100 次取中位/p95。每个历史失败任务属于同一镜且已有待处理替代任务，这是旧实现逐条查询活动任务的放大场景；新实现只运行一条反连接查询。真实产品中同时保留这么多同镜失败记录并不常见，不能把该数字当日常响应时间。

| 同镜历史失败任务 | 原实现中位/p95 | 单查询中位/p95 |
| ---: | ---: | ---: |
| 100 | 0.474 / 0.768 ms | 0.104 / 0.220 ms |
| 1,000 | 4.877 / 9.326 ms | 0.544 / 0.897 ms |
| 10,000 | 46.730 / 79.122 ms | 6.206 / 7.020 ms |
