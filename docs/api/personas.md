# 角色编辑与删除 API

角色接口需要登录，沿用 `{ok:true,...}`／`{ok:false,error,...}`。`GET /api/personas` 返回本人的未删除私人角色与官方角色；已有 `PATCH /api/personas/:id` 和参考图上传协议保持不变。编辑返回新的 `persona.version`，旧作品继续读取不可变历史版本。

## 删除

`DELETE /api/personas/:id`，JSON `{ "version": 3 }`。version 必须是正整数，且等于当前角色版本。成功返回 200 `{ok:true}`，不扣积分。官方角色（owner_id=null）、他人角色及不存在的 ID 返回 404 `not_found`；未登录 401，非法 JSON／版本 400，版本过期 409 `version_conflict`。相同版本重复删除仍返回成功，不生成新版本。

删除仅设置存储层 `personas.deleted_at`，不添加到 Persona DTO，不删除角色版本或文件。删除后列表不显示，编辑、上传、新建期返回角色不存在。已有作品仍按冻结版本读取角色和参考图，权限保持原创建者可见；其他账号不能读取私人图片。建期事务在积分预留前检查角色仍有效，删除与建期并发时按照事务先后决定，删除先提交则建期失败且不扣积分。

前端删除前显示角色名称与影响说明。冲突后刷新核对，不自动删除更新后的版本；请求失败可用原版本重试。没有回收站和恢复接口。迁移支持新库、已有库及旧 owner_id 非空约束的数据库，并可重复执行。

## 穿搭

穿搭是角色文档里的 `outfits`（可缺省，缺省 = 只有默认穿搭），决策与实验见 [ADR-0015](../decisions/0015-persona-outfits.md)。每个角色至多 6 套，每套 1–3 张图，只追加。每次写入都让角色版本 +1，响应带最新 `persona`；旧作品读取自己固定的版本，不受后续增删影响。仅本人私有角色可写；官方、他人、不存在的角色统一 404 `not_found`。

```json
{ "outfit_id": "o_…", "name": "秋日风衣", "desc": "米色长风衣", "seasons": ["秋", "冬"], "refs": ["persona/c_1/….png"] }
```

| 接口 | 请求 | 说明 |
|---|---|---|
| `POST /api/personas/:id/outfits` | multipart：`name`（必填，≤30 字）、`desc`（≤200 字）、`seasons`（可重复字段）、`files`（1–3 张 PNG/JPEG/WebP，单张 ≤10MB） | 201 `{persona, outfit}` |
| `PATCH /api/personas/:id/outfits/:outfit_id` | JSON，仅 `name` / `desc` / `seasons`，至少一项 | `refs` 与 `outfit_id` 不可改，传入返回 400 |
| `POST /api/personas/:id/outfits/:outfit_id/refs` | multipart `files` | 追加；合计超过 3 张返回 400 `invalid_ref_count` |
| `DELETE /api/personas/:id/outfits/:outfit_id` | — | 只从最新版本移除；旧版本、已建作品与图片文件保留 |

错误：`too_many_outfits`（409，已满 6 套）、`outfit_not_found`（404）、`invalid_ref_count`（400）、`invalid_file_type`／`file_too_large`（400）、`upload_too_large`（413）。失败的上传不会留下文件。

**怎么用**：`POST /api/episodes` 传 `outfit_id` 选一套（见 API 参考）。选中穿搭的第 1 张图**替代**角色第 1 张参考图作为人物参考图，不和基础图同时给；`seasons` 只用于界面推荐排序，不限制选择。`brief.outfit_override` 文字仍然只记录，不影响生成。

## 穿搭三视图（ADR-0017）

用户上传一张全身照（`source`），系统生成正 / 侧 / 背三张并拼成一张设定图（`views.sheet`）作人物参考。生成是异步任务：`POST` 创建 job，worker 领取后写回结果。默认穿搭的 source 是角色 `refs[0]`，三视图记在角色自身；自建穿搭的 source 记在该穿搭上。`views_status` 取值 `none`（缺省）/ `pending` / `ready` / `failed`，只有 `ready` 时 `views` 与 `views_gen` 存在。

没有单独的"采用"接口：生成成功即 `ready` 可用；重新生成失败或被取消时，目标还原为旧的三视图（store 负责）。

| 接口 | 请求 | 成功 | 说明 |
|---|---|---|---|
| `POST /api/personas/:id/outfits/source` | multipart：`name`、`desc?`、`seasons?`（可重复）、`files`（**恰好 1 张**，PNG/JPEG/WebP，≤10MB） | 201 `{persona, outfit}` | 创建 source-only 穿搭，`refs: []`、`source` 为新文件。与旧式 `POST …/outfits` 并存（旧式仍要 1–3 张） |
| `POST /api/personas/:id/views` | JSON `{outfit_id?: string\|null, regenerate?: boolean}`；缺省或 `null` 为默认穿搭 | 201 `{job, repeated: false}`；同一目标已有同源在途 job 时 200 `{job, repeated: true}`（不重复预留积分） | 创建生成 job，目标置 `pending`。已 `ready` 须显式 `regenerate: true` |
| `GET /api/personas/:id/views/jobs` | — | 200 `{jobs}`，按创建时间倒序，最多 50 条 | 列出本角色的 job |
| `GET /api/personas/:id/views/jobs/:job_id` | — | 200 `{job}` | 轮询单个 job：`status` 为 `pending` / `processing` / `succeeded` / `failed` / `cancelled`，`result` 在成功后带 `views` 与 `views_gen` |
| `POST /api/personas/:id/views/jobs/:job_id/cancel` | — | 200 `{job, repeated}` | 取消在途 job，释放积分并还原目标；重复取消返回 200 `repeated: true` |

轮询目标的 `views_status`：直接读角色文档，`GET /api/personas` 返回的 `persona.views_status` 与 `persona.outfits[].views_status` 即是。

错误码（`{ok:false, error, message?}`）：

| error | HTTP | 含义 |
|---|---|---|
| `not_found` | 404 | 角色不存在、不属于你、官方角色，或 job 不属于该角色 |
| `outfit_not_found` | 404 | 穿搭不存在 |
| `no_source` | 409 | 该穿搭没有全身照（旧式穿搭） |
| `already_ready` | 409 | 三视图已生成，需 `regenerate: true` |
| `job_active` | 409 | 同一目标已有源图不同的在途 job，先取消它 |
| `not_cancellable` | 409 | job 已成功或已失败，不可取消（已取消的重复取消返回 200） |
| `insufficient_credits` | 402 | 积分不足，未预留、未改动角色 |
| `invalid_persona` | 422 | 角色文档不满足三视图约束（服务端一致性错误） |
| `invalid_body` | 400 | JSON 非法、`outfit_id` 格式不对，或 `regenerate` 不是布尔值 |
| `invalid_ref_count` | 400 | 全身照上传不是 1 张 |

**图片读取**：`GET /api/assets/<key>` 对 `persona/<id>/…` 的 `source` 与 `views.front|side|back|sheet` 按 owner 授权（`canReadPersonaAsset`）。创建者可读，其他账号 404。
