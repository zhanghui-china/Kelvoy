# 提示词记录 API

> 已实现（`apps/web/src/server/routes/episode-prompts.ts`，视图模型 `apps/web/src/shared/prompt-traces.ts`）。字段与行为以 [ADR-0012](../decisions/0012-owner-visible-prompt-traces.md) 为准，偏差须回写本文。

作品所有者查看自己作品发给模型的提示词。使用已登录会话，沿用 `{ok:true,...}` / `{ok:false,error,...}`。新增只读接口，不涉及生成流水线与积分；`api_contract` 保持 1（兼容新增）。

## 请求

`GET /api/episodes/:id/prompts`

| 查询参数 | 说明 |
| --- | --- |
| `kind` | 必填，`script` 或 `video`。`script` 含生成与优化；`video` 为 H3 改写 |
| `shot_id` | 仅 `kind=video` 可选，限定一镜；须匹配 `^[A-Za-z0-9_-]{1,128}$`。`kind=script` 带该参数为 400 |
| `limit` | 可选，默认 20；纯数字且 ≥1，大于 50 夹到 50，其余为 400 |
| `before` | 可选，上一页响应的 `next_before`，不透明游标（实际为正整数十进制串，其余为 400） |

按写入顺序倒序返回（最新在前）。前端仅在用户展开时请求。

## 响应

```json
{
  "ok": true,
  "items": [
    {
      "id": "42",
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
- `id`、`next_before`：字符串，客户端不得解析。
- `input_hash`：仅前 12 位，库内完整值不返回。
- `skill_version`：原样返回（指南内容哈希，非敏感）。
- 可空字段（`shot_id`、`round`、`rule`、`model`、`skill_version`、`writer_version`、`h3_mode`、`correction_message`、`final_prompt`、`input_hash`）缺失时为 `null`。
- 本期不提供 `is_current`。
- `truncated`：任一文本字段曾被截断（单字段 64KB）。
- `legacy`：仅在第一页（无 `before`）且按当前过滤条件没有任何记录时给出说明，其余为 null。`kind=video` 且指定 `shot_id`、该镜作品文档里有非空 `model.video.prompt` 时为 `{"note":"final_only","final_prompt":"<model.video.prompt>"}`（界面「仅保留最终提示词」）；其余无记录情形（脚本、未指定 `shot_id` 的视频、该镜没有最终提示词）为 `{"note":"not_retained"}`（界面「上线前未保留」）。

## 脱敏

由视图模型在边界处完成，不直接返回库行：

- 不返回 `task_id`、`owner_id`、`episode_id`、`seq` 等内部键，`id` 为不透明字符串。
- 视频 `user_message` 先 `JSON.parse`，只处理已知路径字段 `references[].key`，替换为占位 `[reference: role=person, picture=1]`（role 为 `[A-Za-z0-9_-]{1,32}`、picture 为 0–999 整数，否则为 `[reference]`），再紧凑 `JSON.stringify`。元素非对象、`references` 非数组、整体非 JSON 对象或解析失败时，按 fail-closed 处理：非对象元素替换为 `{"key":"[reference]"}`，其余整条返回 `[unavailable]`，绝不回退原文。脚本 `user_message` 原样返回，不做路径扫描。
- 完整 `input_hash` 不出库。
- 不含系统提示词全文与原始 LLM 响应（本期不存）。

## 错误

| 状态 | `error` | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 无会话 |
| 404 | `not_found` | 作品不存在、他人作品、已删除作品；三者响应体完全相同 |
| 400 | `invalid_kind` | `kind` 缺失或非法 |
| 400 | `invalid_shot_id` | `shot_id` 非法，或 `kind=script` 带 `shot_id` |
| 400 | `invalid_limit` | `limit` 非数字或 ≤0 |
| 400 | `invalid_before` | `before` 非正整数 |

先校验所有权再校验参数，故对他人作品的任何请求都是 404。

响应头 `Cache-Control: no-store`（含 400／404）。仅有 GET，其他方法沿用路由默认（404）。

## 分页

游标按写入顺序（`rowid`）倒序。`next_before` 为 null 表示没有更多。数据只追加，因此翻页不会重复或漏项；作品删除后请求返回 404。
