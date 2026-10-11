# 计划：新建作品默认改回"关键帧"流程（直出保留为可选）

## Context

原始设想（PRD v0.1/v0.2 §4）：脚本 → 角色卡/目的地卡参考图 → 每镜关键帧（N 候选）→ 审核 2 选图 → 图生视频 → 审核 3 → 合成。2026-09-27 提交 `aa901f7` 把新项目默认改成 `video_source: "references"` 直出，跳过关键帧与审核 2，PRD 加了一节"2026-09 人物与场景直出视频"覆盖旧描述。用户反映"关键帧选择界面没有了"，并要求改回最初设想。

已确认的范围（用户选择）：
- 默认改回关键帧；直出保留为"高级设置"里的可选项，**不删除** references 分支。
- 不新增"参考图最低数量"校验，沿用现状。

## 事实核对（只读，2026-10-11）

- 关键帧路径代码完整且有真实历史：Spark 上关键帧任务 175 条完成；旧作品（无 `video_source` 字段）走的就是这条。`/image` 在 Inference 里可用，`/llm`、`/upscale` 仍是 501 与此无关。
- 线上现有 references 作品：GX10 8 条、Spark 4 条，均不动，旧作品不自动转换（PRD 已有此承诺）。
- **API 默认值有外部依赖**：`skills/kelvoy-vlog` 与 ADR-0008 明确依赖"`video_source=references` 默认路径（无关键帧审核）"。服务端 `episodes.ts:108`、`:170` 的缺省值若改成 `keyframe`，会让不传该字段的代理/CLI 调用静默改变行为与计费。

## 方案（推荐）

**只改前端默认，不改服务端缺省**——用户看到的"默认"改回关键帧，API 契约不变。

### 1. 前端默认值与文案
- `apps/web/src/frontend/pages/NewEpisodePage.tsx:97`：`useState` 默认值 `"references"` → `"keyframe"`；下拉选项顺序与"（推荐）"标记调换，`:292`、`:331–334` 的说明随之改写；`:279` 的 GuideTip 改为推荐关键帧。
- `apps/web/src/frontend/api/client.ts:259`：`getEstimate` 的默认参数改为 `"keyframe"`（调用方本就显式传入）。
- 同批文案（只改"推荐直出"的措辞，不动逻辑）：`guide.ts:13/27/35`、`HelpPage.tsx:83/127/152`、`SettingsPage.tsx:119`、`LandingFaq.tsx:3`、`LandingFeatures.tsx:3`、`LandingHow.tsx:4`。
- 已有草稿：`episode-draft.ts` 里已保存 `videoSource` 的草稿保持原值（用户当时的选择），未保存的取新默认。不做迁移。

### 2. 直出模式的可见提示（解决"界面没了"）
- `EpisodeDetailPage.tsx`：当 `video_source === "references"` 时，在步骤条旁加一行"本期为直出模式，无关键帧审核；如需选图请新建时选择关键帧方式"。复用现有 `k-card-meta`，无新组件。

### 3. 服务端
- **不改** `episodes.ts` 缺省值与 `validate*`。
- 在 `docs/api` 与 `skills/kelvoy-vlog/references/kelvoy-api.md` 补一句："不传 `video_source` 时仍为 `references`；Web 界面默认 `keyframe`"，避免两处默认值不一致被误读。

### 4. 文档与记录
- 新增 `docs/decisions/0013-default-video-source-keyframe.md`：记录"界面默认改回关键帧、API 缺省保持 references"及原因（成本口径、skill 依赖、旧作品不迁移）。
- PRD v0.2 §"2026-09 人物与场景直出视频"补一小节：UI 默认回到关键帧，直出为可选。
- 同步 `docs/Web端操作手册.md`（:15、:111、:141、:179、:352）、`docs/Kelvoy_AI旅行Vlog生产工作台项目说明文档.md`（:29、:77、:249、:263、:755 及中英文版）。
- `CLAUDE.md` 首段"三个人工审核点"保持不变（回到默认路径后重新成立）。

### 5. 成本口径提醒（不改代码）
默认走关键帧后，新作品会产生图片积分：每镜候选数取用户设置 `default_candidates`（缺省 3），预估积分由现有 `estimateCost` 随 `video_source` 自动给出，无需改动。需让用户知晓默认花费上升。

## 关键文件

- 改：`NewEpisodePage.tsx`、`client.ts`、`EpisodeDetailPage.tsx`、`guide.ts`、`HelpPage.tsx`、`SettingsPage.tsx`、`Landing*.tsx`、对应 `*.test.tsx`（断言默认值与文案的用例）
- 文档：ADR-0013、PRD v0.2、操作手册、项目说明（中/英）、`docs/api`、`kelvoy-api.md`
- 不动：`episodes.ts`、engine/worker/store 的 references 分支、线上作品数据

## 验证

1. `make typecheck && make test`（CLAUDE.md 要求）；先更新断言默认值的前端测试，先红后绿。
2. 本地起 `make web-api` + `make web-app`，打开新建页：默认选中"关键帧"、候选数控件可见、预估积分含图片部分；切到直出时控件隐藏、预估变化。
3. 新建一期（关键帧）走到 `kf_review`，确认选图界面出现；新建一期（直出）确认详情页出现提示行。
4. `grep -rn "references"` 确认服务端缺省值未被改动，且 skill 文档已注明默认差异。

## 发布（本计划不执行，另行确认）

仅前端与文档：沿用"变更包 + 节点 `cp -a` 当前发布目录 + 覆盖 + 重建前端 + `deploy-web-worker.py`"流程，不涉及 DB 迁移与素材；先排空任务（GX10 目前有排队任务），再 Spark → GX10。发布记录补进 `infra/dgx/`。

## 需要用户确认的一点

服务端缺省是否也一并改为 `keyframe`？本计划推荐**不改**（理由见"事实核对"）；若要全局一致，需同时更新 skill 并通知使用方，改动面更大。
