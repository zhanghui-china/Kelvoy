# services/inference

常驻的本地推理服务,被 `apps/worker` 通过 HTTP 在本机/内网调用,不对公网开放。

生产链路通过 `/image/`、`/video/` 适配 ComfyUI；模型权重由 ComfyUI 管理。本服务不自行加载模型。脚本生成与指令优化使用 engine 的 StepFun provider；`/llm/`、`/upscale/` 仍是未接入生产链路的 501 占位接口，不代表 StepFun 脚本不可用。

音乐(MVP 用素材库,不生成)和合成(ffmpeg,在 `apps/worker` 上跑)不在这个服务里。

## 本地跑

```bash
cd services/inference
uv sync
uv run python -m inference
uv run pytest
```

## ComfyUI 图像与视频

`/image/` 使用 Qwen-Image 2.1 的单参考图（角色）或双参考图（角色、地标）工作流；
`/video/` 使用 MiniMax H3：一张参考图走已审核关键帧生视频，两张参考图依次作为角色和场景走双参考直出。两条路径都支持 `size: "9:16"` 或 `"16:9"`，`params.duration_s` 可设为 3、4、5 秒。
两者读取 `comfyui-bridge` 中的 API 工作流文件，调用 `KELVOY_COMFYUI_BASE_URL`
（默认 `http://127.0.0.1:8188`）。请求里的 `refs` 必须是
`KELVOY_PROJECTS_ROOT` 下的相对路径；结果也保存到该目录的 `inference/` 下。
每次请求只生成一个候选，客户端需要多候选时须发起多次请求并保存各自的 seed。
原生分辨率随工作流和画幅变化；历史关键帧视频样片为 480×864 / 864×480，双参考样片为 736×1280 / 1280×736。最终 1080×1920 / 1920×1080、30 fps 由 Worker 合成阶段处理，不能把原始片段当作最终交付验收。

DGX 的 `kelvoy-inference.service` 需要设置
`Environment=KELVOY_PROJECTS_ROOT=/home/Developer/kelvoy/apps/web/projects`，
并从仓库根目录保留 `comfyui-bridge` 工作流。图像生成预算保持 240 秒。两种视频路线统一使用 `KELVOY_VIDEO_TIMEOUT_SECONDS`，默认 900 秒，必须为 30–1800 的整数；Worker 和 Inference 必须设置相同值。
定向取消清理另限 10 秒，Worker HTTP 总预算为视频预算加 60 秒，并关闭 Bun socket idle timeout。

ComfyUI 媒体下载使用流式临时文件，单文件上限 512 MiB；超限会拒绝并尝试取消对应任务。发布前用 Pillow 校验完整 PNG、用 `ffmpeg` 解码视频流；损坏媒体会删除暂存文件并取消对应任务。推理服务和 Worker 所在主机均须将 `ffmpeg`、`ffprobe` 放在 PATH 上，CI 也安装同一运行依赖。这个本地上限不代替 DGX 的总磁盘水位与暂存回收。Worker 的无 ASS/drawtext 文字图层回退使用本项目 `uv sync` 创建的 `.venv/bin/python`，其中已锁定 Pillow；部署时还须提供中文字体。

## 协议与验收边界

成功响应包含 `paths`、`model`、工作流哈希 `version`、`seed` 和非负 `seconds`。Worker 先校验响应形状，再由生成适配层核对单个产物、种子和暂存目录，归档后记录参考图哈希。HTTP 成功但 JSON 不合法或字段类型错误统一为 `invalid_response`；连接失败、调用方取消、超时仍独立区分。ComfyUI 上传/历史/媒体元数据形状错误归一为 502，取得 prompt ID 后会尝试定向取消，取消失败记录日志而不覆盖原始错误。

2026-09-27 的双参考 16:9 样本用时 256.2 秒；后续真实作业仍超过旧 270 秒预算。生成期限包含上传、排队、采样、下载和媒体校验，超时取消仅作用于本次 prompt ID，不清空或中断共享 GPU 队列。超时不自动重跑；网络中断和暂时性服务错误最多尝试两次。参数、格式与内容审核失败不自动重试。

视频错误 `detail` 包含 `stage`、`code`、安全 `message`、`elapsed_seconds`、`budget_seconds` 与 `cancellation`。Worker 兼容旧字符串错误，将诊断记录到既有 `tasks.error`，成功清除，失败结算与租约保护保持同一事务。内部关联头 `X-Kelvoy-Task-Id`、`X-Kelvoy-Shot-Id`、`X-Kelvoy-Attempt` 进入各阶段耗时日志；不记录完整提示词、参考图或密钥。历史证据见 [PR07 适配审计](../../docs/audit/2026-09-27-pr07-inference-adapter.md)。

## 只读系统检测与目标地址

`POST /system/diagnostics` 接受 `{ "comfyui_base_url": null, "bridge_base_url": null }`；
`null` 继承部署配置。bridge 默认地址为 `KELVOY_BRIDGE_BASE_URL`
（未设置时 `http://127.0.0.1:5099`）。此接口由 Web 调用，推理服务继续只部署在可信内网。
部署须显式设置 `KELVOY_BACKEND_ALLOWED_ORIGINS`，例如
`http://127.0.0.1:8188,http://127.0.0.1:5099`；空名单使后端检测项为未检查，生成请求被拒绝；继承地址也须在名单中。继承目标的策略失败只跳过该服务，不阻止其他服务检测；非法显式候选在发起任何网络请求前返回 422。
只允许 HTTP/HTTPS、无凭据、无查询参数或片段的地址，不跟随 HTTP 重定向。

检测仅 GET ComfyUI 的 `/system_stats`、`/queue`、`/object_info` 与 bridge 的 `/health`，
并核对生成正在使用的四套模板节点和模型枚举。单项请求最多 5 秒，总检测最多 15 秒，
不重试，同时请求相同地址的检测会合并。`healthy`、`busy`、`error`、`unchecked` 区分正常、
队列忙碌、异常和未完成检查；`interface_ready` 只表示 ComfyUI 接口内容有效，模型依赖缺失
仍会单独报错。静态检测不证明模型加载或实际出图成功，bridge 是当前生成链路不依赖的伴随服务。

`/image/`、`/video/` 请求可携带顶层 `comfyui_base_url`，覆盖地址经过同一部署名单与格式校验；
省略或传 `null` 时继承 `KELVOY_COMFYUI_BASE_URL`，继承地址也经过同一部署名单与格式校验。目标地址由 Worker 在任务开始时固定，
不通过推理服务写入全站配置。上述检测不提交任务、上传素材、清空或取消队列。
