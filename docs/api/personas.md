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
