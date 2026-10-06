# Kelvoy API 与版本说明

## 基线与证据等级

契约核对日期：2026-10-06。首版目标是 2026-10-05 GX10 部署记录 `c8ab053` 及相关补丁；首次调研源码基线为 `196fe48`。此文区分源码核对、历史部署验收与当前在线验证。

发布前同步 GitHub 时核对到 main `3c34ceb`：新增 compose_ready 阶段、固定一秒剪辑、默认 references 视频来源和积分预留，且没有旧部署的 pacing_version 字段；当前 main 不在此首版契约范围。目标实例若使用这些能力，先暂停旧流程并核对对应版本，不能执行旧 clip_review→composing 直进、旧镜数／时长规则或旧请求形状。新版本适配另作后续能力扩展。

| 能力 | 契约来源／部署记录 | 当前证据 |
| --- | --- | --- |
| Cookie 登录、列表、建期、审核、文件与分享 | 调研源码 `196fe48` 的 Web 路由及 schema | 源码已核对 |
| 真实关键帧与视频 | 2026-10-01 GX10 部署记录，后续部署补丁 | 历史部署验证；本次未在线验证 |
| 三视图门槛、角色引用快照 | persona-turnaround 补丁及部署记录 | 源码／补丁核对；首版只复用已可用角色 |
| 审核推进完整性检查、局部返工 | 隔离源码中的 episode-review 与 generation 用例 | 文件核对；隔离目录不是完整 Git 仓库，不能据此断言运行版本 |
| 失败镜头 `/retry` | manual-retry 补丁；部署记录版本 `91a231f` | 补丁核对，历史检查通过 |
| 合成失败 `/recompose`、无配乐选择持久化 | compose-fallback／no-music-compose 补丁；2026-10-05 部署记录版本 `c8ab053` | 历史黄山成片 30.133333 秒、1080×1920、30 fps；本次未生成 |

本次按部署记录地址做只读健康检查，连接超时，未登录、未读用户资料、未提交任务。上述短提交号是版本来源，不能当成自动能力检测值。首次调研源码 `196fe48` 的 assets/keyframe/video 和 inference image/video 仍是占位实现，不能用于完整出片验收。

实际服务地址、登录状态与版本证据由运行环境提供。健康接口没有版本或能力字段；新实例通过维护者提供的发布版本／源码核对，记录核对时间与能力。未知接口不通过 POST 探测，也不自动降级为直写数据库或调用 Bridge。

仓库维护者可按对应基线的以下来源复核（部署笔记与补丁是首次调研时的本地证据，未随此 Skill 提交）；技能复制到其他位置时仍可用本文件的契约，不强依赖这些仓库路径：

- `apps/web/src/server/routes/{auth,episodes,episode-review,personas,templates,assets,share}.ts`
- `packages/engine/src/schema/{api,episode}.ts` 与 `rules/script.ts`
- `infra/dgx/{gx10-8e22,manual-retry,persona-turnaround,compose-fallback}-deployment.md` 与对应补丁

## 传输与会话

以用户提供的 `base_url` 为根，不假定端口、IP 或 SSH 目录。ID／slug 按一个 URL 段编码，产物 key 按每一段编码并保留 `/` 分隔符；拒绝 `..`、绝对路径或跨域产物地址。

优先使用用户已登录且可调用 API 的浏览器会话。仅在有受保护凭据输入渠道时调用登录；没有该渠道就让用户在 `/login` 登录，不要求其在聊天中发送密码。

```http
POST /api/auth/login
Content-Type: application/json

{"username":"<受保护输入>","password":"<受保护输入>"}
```

成功 200：`{"ok":true,"user":{"user_id":"…","username":"…"}}`，响应设置 HttpOnly `kelvoy_session` cookie。后续请求沿用会话；非浏览器客户端需使用受保护 cookie jar，不输出 cookie，不提交到 Git，不将浏览器 cookie 导出到聊天。登录不会授予访问其他用户作品的权限。

只读接口：

| 请求 | 成功响应要点 |
| --- | --- |
| `GET /api/health` | 200，`{"status":"ok"}`，只证明 Web 可达 |
| `GET /api/me/settings` | 200，`{"ok":true,"settings":{…}}`，可验证会话 |
| `GET /api/personas` | 200，`{"ok":true,"personas":[…]}` |
| `GET /api/destinations` | 200，`{"ok":true,"destinations":[…]}` |
| `GET /api/templates` | 200，`{"ok":true,"templates":[…]}` |
| `GET /api/episodes` | 200，`{"ok":true,"episodes":[…]}`，结果用于续跑与未知建期结果核对 |
| `GET /api/episodes/<id>` | 200，`{"ok":true,"episode":{…},"row_version":7}` |

不要凭列表序号当 ID。期的 `row_version` 是写入锁，与角色／目的地领域版本无关。

## 建期

```http
POST /api/episodes
Content-Type: application/json

{"persona_id":"c_demo","destination_id":"d_demo","template_id":"t_demo","mode":"per_shot","tone":"安静的旅行记录"}
```

必需三个 ID；可选 `series_id/season/tone/banned/mode/outfit_override`。`mode` 为 `per_shot` 或 `grid`，首版只新建逐镜。`banned` 是字符串数组，`outfit_override` 请求值为字符串，省略表示沿用。

成功 201：`{"ok":true,"episode":{…}}`，立即保存 `episode.episode_id`。服务派生 owner、快照、`pacing_version`、9:16、30 秒、render 与估价，自动入队 brief；不另外调用 CLI 或发 script 任务。

错误例：400 `{"ok":false,"error":"content_blocked","violations":[…]}`；404 `persona_not_found/destination_not_found/template_not_found`；要求三视图的部署可返回 409 `persona_turnaround_required`。最后一种应转去角色编辑页，不是乐观锁冲突。

## 审核写入

下面 `7` 只是示例版本；每次写操作前读取当前版本，成功响应也带新版本。不同镜头共用期级锁，不并行提交多镜写入。

| 操作 | 方法与路径 | 请求体示例 |
| --- | --- | --- |
| 改脚本／prompt | `PATCH /api/episodes/<id>/shots/<no>` | `{"row_version":7,"patch":{"beat":"缓慢转身","motion_prompt":"角色缓慢转身，镜头静止"}}` |
| 首次选关键帧 | 同上 | `{"row_version":7,"patch":{"kf_selected":"kf/03_a.png","status":"kf_selected"}}` |
| 已选状态换候选 | 同上 | `{"row_version":7,"patch":{"kf_selected":"kf/03_b.png"}}` |
| 审核视频／选切点 | 同上 | `{"row_version":7,"patch":{"trim_start_s":0.2,"status":"approved"}}` |
| 删除镜头 | `POST /api/episodes/<id>/shots/<no>/remove` | `{"row_version":7}` |
| 重排所有现有镜头 | `POST /api/episodes/<id>/shots/reorder` | `{"row_version":7,"order":[2,1,3,4,5]}` |
| 审核通过后继续 | `POST /api/episodes/<id>/continue` | `{"row_version":7}` |

成功 200：`{"ok":true,"row_version":8}`。脚本可改字段为 `beat/size/camera/landmark/kf_prompt/motion_prompt`；`size=wide/medium/close/detail/pov`，`camera=static/pan/push/follow`，`landmark` 为目的地地标 ID 或 null。不写 `no/scene/duration_s`。

旧服务的通用 ShotPatch 允许更宽字段，不代表 Skill 获准改 worker 产物字段 `candidates/clip/model`。删镜和重排仅在脚本审核使用；服务会检查镜数、景别与地标规则。`order` 必须是全部当前镜号的排列，例中 5 个镜号只适用于恰好 5 镜的测试期。

`/continue` 仅用于三个审核态，分别推进 assets、video、compose。先检查全部必要镜头选择或审核完成，不依赖旧服务的宽松行为：

- `kf_review`：至少一个需生视频镜为 `kf_selected`，key 属于 candidates；其余需生视频镜也完成有效选择，保留镜为 approved 且 clip 非空。所有镜已 approved 的异常 kf_review 状态不能经此接口推进，应交维护者核对，不能伪造一镜回到 kf_selected。
- `clip_review`：所有镜为 approved 且 clip 非空。

部署基线拒绝不完整推进：400 `keyframes_not_selected` 或 `clips_not_approved`。非法阶段返回 `illegal_transition`。

## 返工与合成

重生成（已有候选／片段的改做）：

```http
POST /api/episodes/<id>/shots/<no>/regen
Content-Type: application/json

{"row_version":7,"regen_stage":"video"}
```

`regen_stage=keyframe/video`，Skill 明确提交，不依赖服务推断。源镜状态为 `kf_ready/clip_ready/approved`；已 kf_selected 的源状态在核对版本中会被拒绝。视频返工需要有效的选定关键帧。新版将整期回到相应审核态并保留其他镜头；keyframe 返工支持从 done 或 clip_review 返回 kf_review，video 返工支持从 done 返回 clip_review。其它状态组合以服务校验为准，不伪造 rejected 或 failed 解锁。

失败镜头手工重试（部署扩展）：

```http
POST /api/episodes/<id>/shots/<no>/retry
Content-Type: application/json

{"row_version":7,"regen_stage":"keyframe"}
```

要求镜为 failed；keyframe 要求期为 keyframing/kf_review，video 要求 clipping/clip_review 且有有效已选关键帧。服务创建新任务；不自动调用，不用于生成中任务，不在不支持的实例上用 `/regen` 替代。

重新合成：`POST /api/episodes/<id>/recompose`，body `{"row_version":7}`。调研源码 `196fe48` 支持 done；部署扩展还支持合成 failed 且所有镜 approved、有 clip。仅入队 compose，不重跑图片或视频。不能用修改 status 的 PATCH 代替入队。

无配乐（部署扩展）：用户选择后 `PATCH /api/episodes/<id>`：

```json
{"row_version":7,"patch":{"music":{"file":"missing.mp3","bpm":120,"license":"licensed","enabled":false}}}
```

music 是整体对象替换，示例假设原期已有这份合法配乐对象但文件不可用；实际保留读取到的完整 music，只改 enabled。成功后使用新版本提交 recompose；不支持持久化 enabled 的实例不得使用此扩展。

调研源码 `196fe48` 的校验器要求非空 music.file，初始 `{file:"",bpm:0,license:""}` 的 PATCH 会被拒绝，即使 compose 支持 enabled=false。遇到这种空对象，须有已核对的目标版本校验支持才能保存无配乐选择；否则报告版本限制，交维护者处理。不能捏造文件名来通过校验。缺音乐与素材不足是不同失败，不能把关闭音乐当通用修复。

上述写入成功均为 200 `{"ok":true,"row_version":8}`。

## 文件与分享

| 内容 | URL |
| --- | --- |
| 审片页面 | `/episodes/<id>` |
| 期内图片／片段／成片 | `/api/episodes/<id>/files/<key>`，需该作品所属用户会话 |
| 角色／地标参考图 | `/api/assets/<key>`，角色资产按归属保护 |
| 成片文件约定 | key 为 `final/<episode_id>.mp4`，来自 DoneView 与 share 路由，不是 Episode 的新字段 |

文件 key 来自当前作品字段或核对过的成片约定。不要给相对 key 重复加 `projects/<id>`。成功是二进制文件响应，不是 `{ok:true}`；检查 HTTP 状态、内容类型与实际内容，200 HTML 登录页不能当视频。下载到用户指定的 Git 外目录；用 ffprobe 检查时长、尺寸、帧率和元数据，画面查看 AI 标识。

用户明确要求分享后：`POST /api/episodes/<id>/share`，body `{"row_version":7,"enabled":true}`，成功返回 `{"ok":true,"row_version":8,"slug":"…"}`。页面 `/s/<slug>`；公共文件 `/api/share/<slug>/final.mp4`；不需要登录。不要把受保护的下载链接描述为公开分享链接。

## 错误与请求结果不明

| 情况 | 应对 |
| --- | --- |
| 401 unauthorized／invalid_credentials | 暂停并引导登录，不创建账号或重置密码 |
| 404 not_found | 可能是对象、归属或接口版本问题；核对契约，不泄露其他用户对象 |
| 400 errors／invalid_body／script_rule_violation | 展示服务具体校验，不绕过规则 |
| 409 version_conflict | 响应含 current_row_version；重新 GET，比较目标镜与阶段再决定 |
| 409 persona_turnaround_required | 引导角色页；不能按版本冲突重试建期 |
| 501 not implemented | 该执行版本不具备能力；说明限制 |
| 5xx、超时、断网、非 JSON API 响应 | 记录动作与 ID，先读状态；不盲目重发写请求 |

版本冲突例：`{"ok":false,"error":"version_conflict","current_row_version":9}`。不能只把 7 改成 9 就重放；镜序、候选和决定可能已变。

建期成功响应丢失时用作品列表核对可能的新期；无法唯一确认就暂停。阶段改变或目标字段生效能支持“操作已执行”，但 GET 状态不变不足以证明队列未入队；必要时交维护者核对。读请求可重试，写操作不做隐式自动重试。
