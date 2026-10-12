# 失败重试 API

> 路由：`apps/web/src/server/routes/episode-review.ts`（`POST /:id/retry`）、`episodes.ts`（详情的 `failed_tasks`）。使用已登录会话，沿用 `{ok:true,...}` / `{ok:false,error,...}`。新增字段为兼容新增，`api_contract` 不变。

## 请求

`POST /api/episodes/:id/retry`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `row_version` | 整数 | 必填，作品当前 `row_version` |
| `shot_no` | 正整数 | 可选，只重试该镜的失败任务；该镜无任务记录但镜头为 `failed` 时由服务补发 |
| `all` | 布尔 | 可选，`true` 重试全部可重试失败；`false` 等同不传 |

`shot_no` 与 `all` 互斥；同传、类型不对（非整数、`<=0`、非布尔、`null`）为 400 `invalid_target`。两者都不传时行为与旧版一致：重试最近一个可重试的失败任务。

## 响应

```json
{
  "ok": true,
  "row_version": 8,
  "stage": "video",
  "shot_no": 3,
  "queued": [{ "stage": "video", "shot_no": 3, "resynthesized": false }],
  "skipped": [{ "stage": "video", "shot_no": 5, "reason": "..." }]
}
```

- `stage` / `shot_no`：本次主要重试的任务（`shot_no` 为 `null` 表示期级任务，如合成）。
- `queued`：已入队的任务；`resynthesized` 为 `true` 表示该镜没有可重试的任务记录，由服务按镜头状态补发了新任务。
- `skipped`：被跳过的失败及原因。

## 错误码

| 状态 | `error` | 含义 |
| --- | --- | --- |
| 400 | `invalid_row_version` | `row_version` 缺失或非法 |
| 400 | `invalid_target` | `shot_no` / `all` 非法或同传 |
| 400 | `no_failed_task` | 没有可重试的失败任务（含指定镜没有失败） |
| 400 | `illegal_transition` | 当前状态不允许重试 |
| 402 | `insufficient_credits` | 积分不足，不入队、不扣费 |
| 404 | `not_found` | 作品不存在或不属于当前用户 |
| 409 | `version_conflict` | `row_version` 过期，带 `current_row_version` |

## 详情里的失败列表

`GET /api/episodes/:id` 在原有 `failed_task` 之外新增：

```json
{ "failed_task": { "stage": "video", "shot_no": 3 },
  "failed_tasks": [{ "stage": "video", "shot_no": 3 }, { "stage": "video", "shot_no": 5 }] }
```

- `failed_tasks`：全部可重试失败，无则为 `[]`。`shot_no` 按稳定 `shot_id` 回查当前镜号，与 `failed_task` 同一规则。
- `failed_task` 保持不变（最近一个或 `null`），`skills/kelvoy-vlog` 依赖它。
