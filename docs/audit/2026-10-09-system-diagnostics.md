# 系统检测与后端配置验证（2026-10-09）

实现工作区 `/private/tmp/kelvoy-system-config` 使用独立 Bun 依赖和独立 `services/inference/.venv`。没有链接或同步运行中的 Python 环境。

## GX10 只读验收

通过已有 SSH 部署连接，从 GX10 本机并发 GET 以下接口（每次最多 5 秒，禁止重定向）：Web 8888 `/api/health`、Inference 8100 `/health`、bridge 5099 `/health`、ComfyUI 8188 `/system_stats`、`/queue`、`/object_info`。

| 检查 | 结果 |
| --- | --- |
| Web | healthy，148 ms |
| Inference | healthy，152 ms |
| bridge | healthy，851 ms，实际内容确认 comfyui=connected |
| ComfyUI | system_stats 格式有效，运行 0，等待 0 |
| image / image_single / video / video_reference | 各工作流节点与声明模型枚举齐全 |

使用当前四套生成模板从本地构造静态期望，在远端内存中核对 object_info。没有写远端文件、改服务、创建临时登录会话、修改数据库、上传媒体或调用生成／取消／清队列接口。

这是当前依赖的只读验收，新 `/api/system/*` 和 `/system/diagnostics` 尚未发布到 GX10。真实模型加载和出图没有验证。部署须先指定真实运维用户 ID 和双端 origin 白名单，流程见 `infra/dgx/gx10-system-diagnostics-deployment.md`。

## 自动化范围

覆盖 SQLite 配置持久化／版本／全站任务锁、候选测试不落库、保存／清除的 Worker 真实默认适配器请求和缓存变化；认证／越权、地址策略、重定向、HTTP200异常内容、网络失败、超时、bridge断连、缺节点／模型、队列忙碌、并发检测合并和部分失败。前端覆盖状态过期、失败保留输入、普通／运维展示、同步重复操作锁和请求超时。

静态 UI 使用组件渲染及状态测试，没有在已部署页面自动点击执行配置切换。配置切换语义仅使用模拟后端，不对共享 ComfyUI 提交真实任务。

最终验证：826 项 Bun 测试、100 项 pytest 全部通过；五个 TS 包 typecheck、ruff 与 Vite 生产构建通过，git diff --check 无错误。pytest 有一项既有 Starlette/httpx 弃用警告。Web→Inference 的 health 与诊断 RPC 各最多 5 秒，Inference 内部诊断总预算 15 秒；RPC 提前超时会将依赖标记为未检查。浏览器另有 16 秒请求超时（包含传输余量）。
