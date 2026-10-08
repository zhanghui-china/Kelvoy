# 共享目的地草稿 API

所有草稿和编辑接口使用已登录会话，沿用 `{ok:true,...}` / `{ok:false,error,...}`。公共 `GET /api/destinations` 保持兼容，包含官方和用户发布资源。新增功能不涉及生成流水线，不扣积分；建期仍遵守生成积分契约。`api_contract` 保持 1（兼容新增）。

`Destination.creator_id` 缺省或 null 为官方，用户 ID 为创建者。草稿响应 `draft` 包含 `draft_id`、`creator_id`、`edit_version`、`destination_id`（首次发布前 null）、`base_version`、`content`、`published_version`。`content` 是目的地内容（不含公共 ID、版本、创建者）；地标结构沿用 `id,name,refs,best_time,must_keep`。照片引用由服务端维护，不接受任意路径。

| 请求 | 内容与成功响应 |
| --- | --- |
| `GET /api/destination-drafts` | 本人草稿 `{ok:true,drafts:[...]}` |
| `POST /api/destination-drafts` | `{content?:...}`，返回 `{ok:true,draft}` |
| `GET /api/destination-drafts/:id` | 本人草稿 `{ok:true,draft}` |
| `PUT /api/destination-drafts/:id` | `{edit_version,content}`，返回更新后 `draft` |
| `DELETE /api/destination-drafts/:id` | JSON `{edit_version}`；删除本人草稿；不删除公开目的地与历史照片 |
| `POST /api/destinations/:id/edit` | 仅创建者创建或取得私有编辑草稿，返回 `draft`；官方资源拒绝 |
| `POST /api/destination-drafts/:id/landmarks/:landmarkId/photos` | multipart `edit_version` + 一个或多个 `files`，返回更新后 `draft` |
| `DELETE /api/destination-drafts/:id/landmarks/:landmarkId/photos` | JSON `{edit_version,key}`，返回更新后 `draft` |
| `GET /api/destination-drafts/:id/assets/:path` | 本人草稿实际引用的照片，需会话 |
| `POST /api/destination-drafts/:id/publish` | `{edit_version}`，返回 `{ok:true,draft,destination}`；相同版本重试幂等 |

修改和发布必须使用最新 `edit_version`；冲突 409 `conflict`，应重新读取并让用户核对，不能覆盖较新的内容。会话缺失 401；对象不存在或非创建者 404；输入／发布完整性错误（含单张超 10 MiB）400；超限请求体 413。ID 按 URL 段编码，图片 key 按各段编码保留 `/`。不接受绝对路径、`..`、越界或符号链接跳转。

发布须景区名称、城市、合法类型、至少一个地标，每个地标具备名称、最佳机位／时段、非空须保真特征和 3–10 张照片。介绍、季节、动线、饮食、交通、住宿选填。草稿可不完整。用户选择发布表示照片公开共享，不需管理员审核。

照片支持 JPEG、PNG、WebP，每张最多 10 MiB，每地标最多 10 张，服务端验证格式并完整解码校验（最多 1 亿像素）后生成名字。请求体有总量限制，事务内校验最终数量，上传或数据库写入失败清理本次文件。私有照片仅草稿专属接口可读；`GET /api/destinations/:id/assets/:path` 和 `/api/assets/:path` 必须有已发布版本引用，历史版本的引用仍有效。移除照片／删除草稿不删除历史发布版本使用的文件。

发布原子写入公共目的地及完整版本快照；更新已发布目的地先建立私有编辑草稿，再发布新版本。已有期继续读取其 `destination_version`，不能被新草稿／新版本的照片替换。公开目的地没有用户删除接口。
