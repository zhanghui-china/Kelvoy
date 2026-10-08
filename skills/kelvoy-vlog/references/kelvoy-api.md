# Kelvoy API 参考

本文对应 `api_contract` **1**（GitHub main，GX10 部署于 `b19ee81`）。`GET /api/me` 返回 `api_contract`：不是 1（更大）或缺失（旧实例）都停止并告知用户，不要凭记忆继续。`/api/health` 匿名，没有版本字段。不用写请求去探测。

## 传输与会话

以用户提供的 `base_url` 为根，不假定端口、IP 或 SSH 目录。ID／slug 按一个 URL 段编码，产物 key 按每段编码并保留 `/`；拒绝 `..`、绝对路径、跨域地址。

优先用用户已登录且可调 API 的浏览器会话。只有存在受保护的凭据输入渠道时才调用登录，否则让用户在 `/login` 登录，不要求在聊天里发密码。

```http
POST /api/auth/login
{"username":"<受保护输入>","password":"<受保护输入>"}
```

成功 200：`{"ok":true,"user":{…}}`，设置 HttpOnly `kelvoy_session` cookie。cookie 只放受保护的 jar，不输出、不提交 Git。

## 读取

| 请求 | 响应要点 |
| --- | --- |
| `GET /api/health` | `{"status":"ok"}`，只证明 Web 可达 |
| `GET /api/me` | `{"ok":true,"user":{…},"balance":{"available":N,"reserved":N},"api_contract":1}`，验证会话、读积分余额、读契约版本 |
| `GET /api/me/credits` | `{"ok":true,"balance":{…},"ledger":[…]}`，流水 |
| `GET /api/personas` `/destinations` `/templates` | `{"ok":true,"<复数名>":[…]}` |
| `GET /api/episodes` | `{"ok":true,"episodes":[…]}`，用于续跑和建期结果核对 |
| `GET /api/episodes/<id>` | `{"ok":true,"episode":{…},"persona":…,"destination":…,"row_version":7,"failed_task":{"stage":"video","shot_no":3}\|null}` |
| `GET /api/episodes/estimate?mode=per_shot&video_source=references&candidates=3` | `{"ok":true,"estimate":{…},"credit_quote":N}`。**`estimate.estimated_credits` 其实是 GPU 分钟，向用户报价用 `credit_quote`** |

名称不是 ID，不凭列表序号当 ID。`row_version` 是期级写入锁，每次写前读最新值，成功响应带新值。不同镜头共用期级锁，写入串行。

## 积分

所有生成类操作先预留积分，余额不足返回 **402 `insufficient_credits`**：建期、`/script/*`、`/continue`、`/regen`、`/report-bad`、`/retry`、`/recompose`。预留是分段的：建期只预留 1 份脚本积分；脚本通过、`/continue` 进入 assets 时才按镜数一次性预留全部视频（逐镜关键帧模式则是图片）积分。所以建期成功不代表后面够用，要用 `credit_quote` 预估总额。

遇到 402 停下，告知需要多少、余额多少，让用户联系运维充值。Agent 不发放积分，不换账号绕过。

## 建期

```http
POST /api/episodes
{"persona_id":"…","destination_id":"…","template_id":"…","tone":"安静的旅行记录"}
```

必需三个 ID。可选：`name`、`requirements`、`aspect`（`9:16` 默认）、`video_source`（`references` 默认，或 `keyframe`）、`candidate_count`、`series_id`、`season`、`tone`、`banned`（字符串数组）、`outfit_override`。`mode` 只接受 `per_shot`。服务派生 owner、版本快照、`cut_policy=fixed_1s`、30 秒、render，并自动入队 brief。

成功 201：`{"ok":true,"episode":{…}}`，立即记录 `episode.episode_id`。

错误：400 `errors`／`content_blocked`（带 `violations`）；404 `persona_not_found`／`destination_not_found`／`template_not_found`；402 `insufficient_credits`。

## 状态机

```text
draft → scripting → script_review → assets ─┬→ keyframing → kf_review → clipping ┐
                                            └──────── (references) ──→ clipping ┤
      → clip_review → compose_ready → composing → done        任一生成态可 → failed
```

`video_source=references`（默认）在 assets 之后直接进 `clipping`，**没有 kf_review**。`keyframe` 模式才有关键帧审核。`/continue` 可从四个审核态推进：`script_review`、`kf_review`、`clip_review`、`compose_ready`。`clip_review` 在 `fixed_1s` 下先进 `compose_ready`，再 `/continue` 才进 `composing`。非 `fixed_1s` 的旧期 `clip_review` 直接进 `composing`。

## 审核写入

### 改镜头

`PATCH /api/episodes/<id>/shots/<no>`，body `{"row_version":7,"patch":{…}}`，成功 `{"ok":true,"row_version":8}`。可写字段取决于期阶段，不在表内的组合返回 400 `invalid_public_patch`：

| 期阶段 | 可写字段 |
| --- | --- |
| `script_review` | `beat`、`caption`、`size`、`camera`、`landmark`、`kf_prompt`、`motion_prompt` |
| `kf_review` | `kf_selected`、`status`（仅 `kf_selected`）、`kf_prompt`、`motion_prompt` |
| `keyframing` | `kf_selected`、`status` |
| `clip_review` | `trim_start_s`、`status`（仅 `approved`，且镜为 `clip_ready`） |
| 其他（含 `done`） | 不可改 |

`size`=`wide/medium/close/detail/pov`；`camera`=`static/pan/push/follow`；`landmark` 为目的地地标 ID 或 `null`，必须存在于该期快照的地标里。`kf_selected` 必须属于该镜 `candidates`，选图时同时写 `"status":"kf_selected"`（镜为 `kf_ready`）；已是 `kf_selected` 换图只写 `kf_selected`。`fixed_1s` 下 `trim_start_s` 会被服务对齐到 1/30 秒。文本字段过内容审核，命中返回 400 `content_blocked`。

**prompt 只能在 `script_review` 和 `kf_review` 改，`references` 模式只剩 `script_review`。** `clip_review`／`done` 阶段无法改 prompt，`/regen` 只会用已有 prompt 重做。

### 脚本动作（仅 `script_review`）

| 操作 | 请求 |
| --- | --- |
| 整体重写脚本 | `POST /api/episodes/<id>/script/regenerate` `{"row_version":7}` |
| 按意见优化脚本 | `POST /api/episodes/<id>/script/optimize` `{"row_version":7,"instruction":"…"}`，instruction 1–500 字 |
| 删镜头 | `POST /api/episodes/<id>/shots/<no>/remove` `{"row_version":7}`，不能低于 24 镜 |
| 重排 | `POST /api/episodes/<id>/shots/reorder` `{"row_version":7,"order":[…全部现有镜号…]}` |

脚本动作返回 `{"ok":true,"row_version":8,"task_id":"…"}`，是异步任务。处理期间所有写操作返回 400 `action_pending`，只观察，完成后重新读作品。删镜和重排会重跑脚本规则，违规整单驳回：400 `script_rule_violation`，`violations` 带原因。规则：24–30 镜、同景别不连续超过 2 镜、至少 5 个地标镜、地标引用有效。

### 继续

`POST /api/episodes/<id>/continue` `{"row_version":7}` → `{"ok":true,"row_version":8}`。推进前服务校验：

- `kf_review`：至少一镜 `kf_selected`；每个镜要么 `approved` 且有 clip，要么 `kf_selected` 且所选 key 在 `candidates` 里。否则 400 `keyframes_not_selected`。
- `clip_review`／`compose_ready`：所有镜 `approved` 且有 clip，否则 400 `clips_not_approved`。
- 非审核态 400 `illegal_transition`；脚本任务进行中 400 `action_pending`；余额不足 402。

## 返工、重试、重合成

| 操作 | 请求 | 约束 |
| --- | --- | --- |
| 重做某镜 | `POST /api/episodes/<id>/shots/<no>/regen` `{"row_version":7,"regen_stage":"video"}` | `regen_stage`=`keyframe`/`video`，可省略，服务按镜状态推断；明确传更稳。镜须为 `kf_ready`／`clip_ready`／`approved`。期须在对应审核态或 `done`。`references` 模式不支持 `keyframe`；`keyframe` 模式做 `video` 需要有效的已选关键帧。整期回到相应审核态，其他镜保留 |
| 坏镜免费重做 | `POST /api/episodes/<id>/shots/<no>/report-bad` | 同 `/regen` 的 body 与约束，仅视频阶段、每镜第一次免费 |
| 重试失败任务 | `POST /api/episodes/<id>/retry` `{"row_version":7}` | **期级**，不分镜。服务取最近一个可重试的失败任务；没有则 400 `no_failed_task`。先读 `GET` 详情里的 `failed_task` 告诉用户是哪一步 |
| 重新合成 | `POST /api/episodes/<id>/recompose` `{"row_version":7}` | 只允许 `done`。合成失败走 `/retry` |
| 旧期转固定一秒 | `POST /api/episodes/<id>/convert-cuts` `{"row_version":7}` | 仅无 `cut_policy=fixed_1s` 的旧期，且在 `clip_review`／`done` 且全部镜有 clip。转换后所有镜回到 `clip_ready`，须重新审核，让用户决定 |

不合法的组合返回 400 `illegal_transition`，原样告知用户，不用 PATCH 状态绕过。

### 配乐与渲染

`PATCH /api/episodes/<id>` `{"row_version":7,"patch":{"render":{…}}}`，只允许改 `render` 和 `music`，且仅在 `compose_ready` 或 `done`。`render.res/fps/ai_label` 不可改；`intro` 只能是 `null` 或 `intro/kelvoy_open.mp4`，`outro` 只能是 `null` 或 `outro/kelvoy_close.mp4`；`title` 过内容审核。`music` 要么是空对象 `{"file":"","bpm":0,"license":""}`，要么是曲库内一条完整记录。没有关闭配乐的开关，`music` 为空时服务按 tone 自动选曲。

## 文件与分享

| 内容 | URL |
| --- | --- |
| 审片页面 | `/episodes/<id>` |
| 期内文件 | `GET /api/episodes/<id>/files/<key>`，需所属用户会话 |
| 角色／地标参考图 | `/api/assets/<key>` |
| 成片 | key 取 `episode.final.key`（形如 `final/<id>_v<n>.mp4`），只在 `done` 时可取，重新合成期间旧成片不可取 |

`episode.final` 带 `version`、`duration_s`、`width`、`height`、`fps`、`size_bytes`、`completed_at`。别猜 key，也别给相对 key 重复加 `projects/<id>`。文件响应是二进制，检查 HTTP 状态、content-type 与内容；200 HTML 登录页不是视频。

分享：`POST /api/episodes/<id>/share` `{"row_version":7,"enabled":true}` → `{"ok":true,"row_version":8,"slug":"…"}`。公开页 `/s/<slug>`，公开成片 `/api/share/<slug>/final.mp4`。关闭分享后 slug 保留，再开启仍是同一个。受保护的下载链接不是公开分享链接。

## 错误与请求结果不明

| 情况 | 应对 |
| --- | --- |
| 401 `unauthorized`／`invalid_credentials` | 暂停并引导登录，不创建账号或重置密码 |
| 402 `insufficient_credits` | 见「积分」 |
| 404 `not_found` | 对象缺失、不属于当前用户或接口不存在；不泄露他人对象 |
| 400 `errors`／`invalid_body`／`invalid_row_version` | 请求形状有误，修正后再发 |
| 400 `invalid_public_patch`／`illegal_transition`／`action_pending` | 当前阶段不允许，告诉用户，不绕过 |
| 400 `script_rule_violation`／`content_blocked` | 展示 `violations`，让用户改 |
| 409 `version_conflict` | 响应含 `current_row_version`；重新 GET，比较目标镜与阶段再决定 |
| 5xx、超时、断网、非 JSON | 先读状态，不盲目重发写请求 |

版本冲突不能只把 7 改成 9 就重放，镜序、候选和用户的决定可能已变。写请求结果不明时：GET 作品，看预期变化（阶段改变、目标字段生效、`script_pending_task_id` 出现）是否已生效；状态不变不足以证明任务没入队，无法确认就暂停并交运维核对。建期没拿到 ID 时读作品列表，按创建时间、角色、目的地、模板、name 核对，多个匹配或仍不明时不再建期。读请求可重试，写请求不隐式重试。


## 共享目的地与私有草稿

目的地列表仍返回 `destinations`，包含官方和用户公开发布的共享资源。新增 `creator_id` 缺省／null 表示官方；用户 ID 表示创建者。这是兼容的新增能力，`api_contract` 保持 1。只有发布后的目的地可用于建期，旧期冻结的版本不随目录更新。公共图片和 `/api/assets/dest/...` 只接受已发布版本引用；未发布照片由创建者草稿接口读取。

本生产技能仍只使用已发布的目录，不自动创建、上传或发布素材。缺目的地时，引导用户在 `/destinations` 的“创建目的地”“我的草稿”完善地标实景照片并发布，完成后重新读取目录。目的地草稿操作不扣积分，建期仍可能返回 402。维护者的完整新增接口说明见仓库 `docs/api/destination-drafts.md`。


## 角色退出可选库

角色库新增本人角色删除，采用软删除；`GET /api/personas` 不再列出已删除角色，新建一期不能选择它们。官方角色仍只读。已有期按冻结的 `persona_version` 读取保留的历史版本与照片，仍可继续生产；不要因角色在当前列表缺失而重新建角色或换掉旧期引用。

维护接口 `DELETE /api/personas/:id` 接受 `{version}`：本人当前版本删除成功，同版本重试幂等；非本人／官方／不存在 404，版本过期 409 `version_conflict`。本生产技能仍不管理素材或主动删除角色；需要调整角色时引导用户在 `/personas` 操作。新增接口兼容现有生产契约，`api_contract` 保持 1。
