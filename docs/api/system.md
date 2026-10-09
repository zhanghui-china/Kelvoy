# 系统配置与只读诊断

所有 `/api/system/*` 接口要求 `kelvoy_session`，未登录返回 401。修改权限来自 Web 环境 `KELVOY_OPERATOR_USER_IDS`（逗号分隔精确用户 ID），空值默认没有运维账号。

## GET /api/system/config

普通用户：`{ "ok": true, "operator": false }`，不泄露地址、修改人或配置版本。

运维用户：`{ "ok": true, "operator": true, "config": { "version": 1, "comfyui_base_url": null, "bridge_base_url": null, "updated_by": null, "updated_at": null } }`。

继承地址在远端 Inference 解析，检测后在结果中显示实际地址。

## POST /api/system/test

检测当前配置：`{}`。运维可测试未保存输入：`{ "comfyui_base_url": "http://gpu:8188", "bridge_base_url": null }`，可带正整数 version（不参与测试、不传给 Inference）。普通用户携带候选字段返回 403。测试不写库。

响应 `ok` 表示诊断请求已处理，不代表每项服务正常：

```json
{"ok":true,"checked_at":"2026-10-09T00:00:00Z","checks":[
  {"service":"web","status":"healthy","duration_ms":0},
  {"service":"inference","status":"healthy","duration_ms":3},
  {"service":"comfyui","status":"busy","duration_ms":20,"interface_ready":true,"address":"http://gpu:8188","queue":{"running":1,"pending":0},"dependencies":[{"workflow":"image","status":"healthy","missing_nodes":[],"missing_models":[]}]},
  {"service":"bridge","status":"error","duration_ms":4,"reason":"bridge backend disconnected"}
]}
```

状态 healthy／busy／error／unchecked 对应正常／忙碌／异常／未检查。运维另有实际地址、详细失败原因、队列与四套生成模板的节点／模型枚举检查；普通用户只返回 service/status/duration_ms 和简化失败原因。部分失败保留其他结果。bridge 为伴随服务，Worker 进程未检查。

## PATCH /api/system/config

仅运维：`{ "version": 1, "comfyui_base_url": "http://gpu:8188", "bridge_base_url": null }`。两个字段均必填，null 恢复继承；成功返回 `{ "ok": true, "config": ... }`，版本递增，记录账号 ID 与 UTC 修改时间。

| 状态 | error | 原因 |
| --- | --- | --- |
| 400 | invalid_config | 非法字段／URL、覆盖 origin 不在部署白名单、非法版本 |
| 403 | forbidden | 非运维用户提交候选或保存 |
| 409 | version_conflict | 配置版本已变化，重新加载后再保存 |
| 409 | tasks_active | 全站有 held/pending/processing 任务，等待空闲后重试 |
| 422 | backend_unreachable | ComfyUI system_stats／queue 不可达或内容格式异常 |
| 502 | diagnostics_failed | Inference 诊断失败／响应格式异常／总超时 |

保存前重新验证接口，不依赖浏览器此前测试结果。静态依赖缺失和 bridge 故障不阻止可达接口保存。保存只影响之后任务。每次测试最长 15 秒，单个请求最多 5 秒、无重试，重复并发合并。

## Inference 内部协议

`POST /system/diagnostics` 只接受两个可空地址，返回 checked_at 与 comfyui／bridge 两项检查。内部 `/image/`、`/video/` 请求可增加 `comfyui_base_url`，缺省/null 继承 `KELVOY_COMFYUI_BASE_URL`。Web、Worker 与 Inference 应同版本发布。地址双端验证，Inference 还验证继承诊断地址；两端 `KELVOY_BACKEND_ALLOWED_ORIGINS` 需显式列出 origin，禁止重定向。
