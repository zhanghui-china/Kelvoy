# 自由分镜 API（契约 2）

需要登录且只能操作自己的期。仅逐镜模式；脚本生成后任一阶段无 held/pending/processing 任务时可编辑。所有写请求带当前 `row_version`；409 必须重新读期并让用户检查，不自动重放。编号仅是顺序，客户端从期详情取得 `shot_id`。

| 接口（前缀 `/api/episodes/:id`） | 请求 | 返回 |
| --- | --- | --- |
| `POST /storyboard` | `{row_version,after_shot_id:null或已有ID,shot:ShotDraft}` | `{ok:true,row_version,shot_id}` |
| `PATCH /storyboard/:shotId` | `{row_version,patch:Partial<ShotDraft>}` | `{ok:true,row_version}` |
| `POST /storyboard/:shotId/remove` | `{row_version}` | 同上，历史素材保留 |
| `POST /storyboard/reorder` | `{row_version,order:[全部现有shot_id的新顺序]}` | 同上 |
| `POST /storyboard/suggestions` | `{row_version,after_shot_id,description,fields:Partial<ShotDraft>}` | `{ok:true,row_version,task_id}` |
| `GET /storyboard/suggestions/:taskId` | 无 | `{ok:true,status,suggestion?,error?}`，结果仅创建者可读 |

`ShotDraft` 为 scene、size、beat、caption?、camera、landmark、kf_prompt、motion_prompt。枚举沿用 Shot，scene 为本期场景 ID，无场景首次添加传空字符串；landmark 为冻结目的地版本的 ID 或 null。beat 与两种提示词必填非空，字幕可空；文本除字幕上限 2000，字幕 120。不能指定 shot_id、no、状态、产物、模型或时长，服务端生成新身份，新镜默认 1 秒。

404 表示期／镜头／任务不可见；400 表示非法输入、状态、排序、引用或 `action_pending`；409 为 `storyboard_busy` 或 `version_conflict`，返回 current_row_version；AI 或生成余额不足 402。内容仍受现有安全规则限制。所有输入及参考引用在 store 事务内重新校验。

期详情新增 `storyboard_busy`、`storyboard_warnings:string[]`、`storyboard_prices:{script,image,video,compose}`。24–30 镜、地标数量、景别连续只作人工创作建议，至少一镜且所有必填完整才可继续。`Episode.final_needs_recompose` 与 `shared_storyboard` 表示修改后的期仍保有上一版成片及分镜；成功合成后同时替换。

保存内容或结构后回到 script_review；继续只为缺失图片／视频排队并预留积分，有候选图时要求选择，有有效未审片段时直接回片段审核，全部有效且批准时进入 compose_ready。手工编辑免费，AI 建议按 script 单价预留／结算，失败释放；结果先供用户确认，不自动插入。

旧 `/shots/:no` 编辑、删除、重排、审核及返工接口保持可用，仍按当前 no 和 row_version 定位；新客户端用稳定 ID 编辑结构。SQLite 新增 tasks.shot_id/payload_json/result_json/error，旧期 JSON 与任务补齐稳定身份，旧文件引用不改名。模型结果由租约及镜头身份共同防护，已删除镜头不能被旧任务复活。
