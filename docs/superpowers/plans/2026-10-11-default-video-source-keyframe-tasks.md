# 任务拆分：新建作品默认改回"关键帧"流程

对应计划：[`2026-10-11-default-video-source-keyframe.md`](2026-10-11-default-video-source-keyframe.md)。状态：T1–T6 已在分支 `feat/default-keyframe-ui` 完成并集成，T7 自动化验证已通过、浏览器走查未做，T8 未发布（2026-10-11）。

## 总体约束

- 范围：**只改前端默认值与文案，不改服务端缺省值**（`apps/web/src/server/routes/episodes.ts:108`、`:170` 保持 `?? "references"`）。
- 不删除 references 分支；线上已有 references 作品不迁移。
- 子代理规则：不 build、不 test、不 typecheck，早提交、早返回；每个任务一个分支一个 worktree，完成后清理。测试、冲突解决、整合与合并由主 agent 负责。
- 提交信息用中文正文，带 Co-Authored-By；子代理不 push。

## 依赖与并行

```
T1 前端默认值 ─┐
T2 文案同步   ─┤
T3 直出提示行 ─┼─→ T7 集成验证 ─→ T8 发布（另行确认）
T4 API/skill 文档 ┤
T5 ADR 与 PRD  ─┤
T6 手册与说明  ─┘
```

T1–T6 文件互不重叠，可并行；T1 独占 `NewEpisodePage.tsx`，T2 不得触碰它。T5 的 ADR 编号以合并时 `docs/decisions/` 最新编号为准（当前最新为 0012，故为 0013）。

---

## T1 前端默认值与新建页文案

**修改范围**
- `apps/web/src/frontend/pages/NewEpisodePage.tsx`：`useState` 默认值（约 `:97`）`"references"` → `"keyframe"`；"视频生成方式"下拉的选项顺序与"（推荐）"标记对调（约 `:331–334`）；引导文案与说明（约 `:279`、`:292`、`:334`）按关键帧为默认改写。
- `apps/web/src/frontend/api/client.ts`：`getEstimate` 的 `videoSource` 缺省参数（约 `:259`）改为 `"keyframe"`。
- `apps/web/src/frontend/pages/episode-draft.ts`：核对草稿恢复逻辑——草稿里已保存 `videoSource` 的保持原值，未保存的取新默认；不做迁移。
- 对应测试：`NewEpisodePage*.test.tsx`、`episode-draft` 相关测试中断言默认值与文案的用例。

**不得修改**：服务端任何文件；`VideoSource` 类型与取值。

**验收标准**
1. 新建页首次打开：视频生成方式默认选中"先生成关键帧候选，再做视频"，"每镜候选数"控件可见。
2. 切换到直出：候选数控件隐藏，预估积分随之变化；切回恢复。
3. 草稿恢复：已保存 `references` 的旧草稿恢复后仍是直出；没有该字段的草稿恢复后是关键帧。
4. `getEstimate` 不传第三个参数时请求里 `video_source=keyframe`；显式传入时不受影响。
5. 受影响的前端测试断言已更新并通过，无新增跳过。

---

## T2 帮助、引导与落地页文案同步

**修改范围**（只改"推荐直出"的措辞，不动逻辑）
- `apps/web/src/frontend/guide.ts`（约 `:13`、`:27`、`:35`）
- `apps/web/src/frontend/pages/HelpPage.tsx`（约 `:83`、`:127`、`:152`）
- `apps/web/src/frontend/pages/SettingsPage.tsx`（约 `:119`）
- `apps/web/src/frontend/pages/LandingFaq.tsx`（约 `:3`）、`LandingFeatures.tsx`（约 `:3`）、`LandingHow.tsx`（约 `:4`）
- 检索残留：`apps/web/src/frontend` 下"直出""跳过关键帧""人物与场景"相关措辞；以及对应测试里断言这些文案的用例。

**不得修改**：`NewEpisodePage.tsx`（属 T1）；任何组件逻辑。

**验收标准**
1. 上述文件里不再出现"推荐直出视频""默认的直出流程"等把直出描述为默认或推荐的措辞。
2. 文案同时仍如实说明两条路径：关键帧需逐镜选图；直出跳过图片生成与关键帧审核。
3. 设置页对"每镜候选数"的说明与新默认一致（默认路径下候选数生效）。
4. 文案相关测试已更新并通过；`grep` 不再命中旧措辞（给出命令与结果）。

---

## T3 直出模式的可见提示

**修改范围**
- `apps/web/src/frontend/pages/EpisodeDetailPage.tsx`：当 `episode.video_source === "references"` 时，在步骤条旁渲染一行 `k-card-meta`："本期为直出模式，无关键帧审核；如需选图，请新建时选择关键帧方式。"
- 新增或扩展该页的前端测试。

**不得修改**：`StageSteps.tsx` 的阶段定义；关键帧审核组件。

**验收标准**
1. `video_source === "references"` 的作品详情页显示该提示；`keyframe` 与缺省字段（旧作品）不显示。
2. 提示在回看模式（只读阶段回看）下同样不重复、不遮挡操作入口。
3. 无新组件、无新样式类（复用 `k-card-meta`）。
4. 新增测试覆盖三种取值（`references` / `keyframe` / 缺省）。

---

## T4 API 文档与 skill 文档注明默认差异

**修改范围**
- `docs/api/` 中描述创建作品请求的文档：注明"不传 `video_source` 时服务端缺省为 `references`；Web 界面默认 `keyframe`"。
- `skills/kelvoy-vlog/references/kelvoy-api.md`：同样注明，并提示依赖直出路径的调用方应显式传 `video_source`。
- `docs/decisions/0008-agent-production-skill.md`：不改正文，仅在 ADR 新建（T5）中交叉引用。

**不得修改**：`skills/kelvoy-vlog` 的脚本与行为；服务端代码。

**验收标准**
1. 两处文档均明确写出"服务端缺省 `references` / Web 默认 `keyframe`"，且示例请求显式带 `video_source`。
2. `grep -rn "video_source" skills/kelvoy-vlog docs/api` 给出的描述互不矛盾。
3. `episodes.ts` 的缺省值未被改动（`git diff` 中不出现）。

---

## T5 ADR 与 PRD 补记

**修改范围**
- 新增 `docs/decisions/0013-default-video-source-keyframe.md`：背景（2026-09-27 默认改为直出，用户反馈"关键帧选择界面没有了"）、决策（界面默认回到关键帧；服务端缺省保持 `references`）、理由（成本口径、`skills/kelvoy-vlog` 依赖、旧作品不迁移）、影响与回退（改回前端默认值即可）。
- `docs/AI旅行Vlog生产工作台_PRD_v0.2.md`：在"2026-09 人物与场景直出视频"一节后补一小节，说明 UI 默认回到关键帧、直出为可选；保留原有"旧项目不自动转换"。
- `docs/README` 或 ADR 索引（如存在）补一行。

**不得修改**：PRD §6 数据模型；v0.1 PRD。

**验收标准**
1. ADR 含状态、背景、决策、后果、替代方案与"不选"的理由（至少：服务端缺省一并改动、彻底删除直出）。
2. PRD 新小节与 ADR 结论一致，且不与前文"新项目必须先生成关键帧"形成新的矛盾（已有覆盖说明则指向它）。
3. `CLAUDE.md` 首段"三个人工审核点"无需改动（在 ADR 里说明理由）。

---

## T6 操作手册与项目说明同步

**修改范围**
- `docs/Web端操作手册.md`（约 `:15`、`:111`、`:141`、`:179`、`:352`）
- `docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md`（约 `:29`、`:77`、`:249`、`:263`、`:755`）及其英文版 `_en.md` 的对应段落
- `docs/Web技术白皮书.md` 中把直出写成默认的描述（先检索再改）

**不得修改**：架构与数据模型描述；历史审计文档（`docs/audit/`）。

**验收标准**
1. 各文档里"新项目默认直出"改为"新建界面默认关键帧，直出可在高级设置选择"。
2. "两条创作路径""三个人工审核点"等表述前后一致；手册 §15.1 的选择建议更新（适合场景、成本差异）。
3. 中英文版措辞对应，无一边改一边漏。
4. 检索命令（如 `grep -rnE "新项目默认|默认.{0,6}直出"`）在 `docs/` 非历史文档中无残留。

---

## T7 集成验证（主 agent）

**修改范围**：不写功能代码；合并 T1–T6 分支到集成分支，解决冲突，跑回归。

**验收标准**
1. `make typecheck && make test` 全绿（贴出通过数）。
2. 本地 `make web-api` + `make web-app`，浏览器走查：
   - 新建页默认关键帧、候选数可见、预估含图片积分；
   - 创建关键帧作品并走到 `kf_review`，选图界面出现；
   - 创建直出作品，详情页出现 T3 提示行；
   - 打开一条旧作品（无 `video_source`），行为不变。
3. `git diff main` 中不含 `apps/web/src/server/routes/episodes.ts` 的缺省值改动、不含 engine/worker/store 的改动。
4. 文档链接与相对路径有效。

---

## T8 发布（另行确认，不随本计划自动执行）

**范围**：仅前端与文档，无数据库迁移、无素材、不动 Inference 与 Worker 逻辑。

**步骤**：变更包（`COPYFILE_DISABLE=1`，含 `RELEASE.json` 清单）→ 节点 `cp -a` 当前线上发布目录并覆盖 → 节点上重建前端并 `dist_stamp.py stamp/verify` → `deploy-web-worker.py` 切换（先排空任务）→ 切换后核对。顺序 Spark → GX10；记录补进 `infra/dgx/`。

**验收标准**
1. 两节点：三个服务 active、重启 0、健康 `ok`、近 3 分钟日志无错误、`STEPFUN_MODEL` 未变。
2. 线上新建页默认关键帧；已有 references 作品仍可正常打开与继续。
3. 发布记录含目录、备份路径、切换时间、实测数字与回退方式（删除新 drop-in、`daemon-reload`、重启 web/worker）。
4. 发布前确认节点磁盘余量（GX10 曾为 97%）。

---

## 未决项

- **服务端缺省是否也改为 `keyframe`**：推荐不改（见计划"事实核对"）。若用户改变决定，需新增任务：改 `episodes.ts` 缺省与 `validate*`、更新 `skills/kelvoy-vlog` 与相关集成测试、通知调用方，并重新评估计费口径。
- **默认候选数**：沿用用户设置 `default_candidates`（缺省 3）。是否借此机会把缺省降到 1–2 以控制默认成本，不在本计划内，需单独决定。
