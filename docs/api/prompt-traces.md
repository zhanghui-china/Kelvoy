# 提示词记录 API

> 设计中，未实现。字段与行为以 [ADR-0012](../decisions/0012-owner-visible-prompt-traces.md) 为准，实现时如有偏差须回写本文。

作品所有者查看自己作品发给模型的提示词。使用已登录会话，沿用 `{ok:true,...}` / `{ok:false,error,...}`。新增只读接口，不涉及生成流水线与积分；`api_contract` 保持 1（兼容新增）。

## 请求

`GET /api/episodes/:id/prompts`

| 查询参数 | 说明 |
| --- | --- |
| `kind` | 必填，`script` 或 `video`。`script` 含生成与优化；`video` 为 H3 改写 |
| `shot_id` | 仅 `kind=video` 可选，限定一镜 |
| `limit` | 可选，默认 20，最大 50 |
| `before` | 可选，上一页响应的 `next_before`，不透明游标 |

按写入顺序倒序返回（最新在前）。前端仅在用户展开时请求。

## 响应

```json
{
  "ok": true,
  "items": [
    {
      "id": "...",
      "kind": "h3_rewrite",
      "shot_id": "s3",
      "round": null,
      "attempt": 2,
      "source": "llm",
      "outcome": "ok",
      "validated": true,
      "rule": null,
      "model": "...",
      "skill_version": "...",
      "writer_version": "...",
      "h3_mode": "i2va",
      "user_message": "...",
      "correction_message": null,
      "final_prompt": "...",
      "input_hash": "0123456789ab",
      "truncated": false,
      "created_at": "2026-10-11T00:00:00Z"
    }
  ],
  "next_before": null,
  "legacy": null
}
```

- `kind`：`script_generate`、`script_revision`、`h3_rewrite`。
- `source`：`llm` 或 `cache`。`cache` 条目界面标「命中缓存，沿用此前改写结果」。
- `validated`：`false` 时界面标「未通过校验」，`outcome` 与 `rule` 说明原因（含 `prompt_format_invalid`、内容拦截）。
- `input_hash`：仅前 12 位，库内完整值不返回。
- `truncated`：任一文本字段曾被截断（单字段 64KB）。
- `legacy`：该作品没有任何记录时给出说明。视频为 `{"note":"final_only","final_prompt":"<model.video.prompt>"}`（界面「仅保留最终提示词」），脚本为 `{"note":"not_retained"}`（界面「上线前未保留」）。有记录时为 null。

## 脱敏

由视图模型在边界处完成，不直接返回库行：

- 不返回 `task_id`、`owner_id`、`episode_id`、`seq` 等内部键，`id` 为不透明字符串。
- `user_message` 中的参考图存储路径替换为占位，保留 role 与 picture 序号（例如 `[reference: role=character, picture=1]`）。
- 完整 `input_hash` 不出库。
- 不含系统提示词全文与原始 LLM 响应（本期不存）。

## 错误

| 状态 | `error` | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 无会话 |
| 404 | `not_found` | 作品不存在、他人作品、已删除作品；三者响应体完全相同 |
| 400 | 待实现时与既有路由对齐 | `kind` 缺失或非法、`kind=script` 带 `shot_id`、`limit`／`before` 非法 |

响应头 `Cache-Control: no-store`。

## 分页

游标按写入顺序（`rowid`）倒序。`next_before` 为 null 表示没有更多。数据只追加，因此翻页不会重复或漏项；作品删除后请求返回 404。
