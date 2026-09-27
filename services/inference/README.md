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
并从仓库根目录保留 `comfyui-bridge` 工作流。图像和关键帧视频生成预算为 240 秒，双参考视频为 270 秒；
定向取消清理另限 10 秒，调用方保留 300 秒 HTTP 超时，双参考路线仍有约 20 秒响应传输余量。

ComfyUI 媒体下载使用流式临时文件，单文件上限 512 MiB；超限会拒绝并尝试取消对应任务。发布前用 Pillow 校验完整 PNG、用 `ffmpeg` 解码视频流；损坏媒体会删除暂存文件并取消对应任务。推理服务和 Worker 所在主机均须将 `ffmpeg`、`ffprobe` 放在 PATH 上，CI 也安装同一运行依赖。这个本地上限不代替 DGX 的总磁盘水位与暂存回收。Worker 的无 ASS/drawtext 文字图层回退使用本项目 `uv sync` 创建的 `.venv/bin/python`，其中已锁定 Pillow；部署时还须提供中文字体。

## 协议与验收边界

成功响应包含 `paths`、`model`、工作流哈希 `version`、`seed` 和非负 `seconds`。Worker 先校验响应形状，再由生成适配层核对单个产物、种子和暂存目录，归档后记录参考图哈希。HTTP 成功但 JSON 不合法或字段类型错误统一为 `invalid_response`；连接失败、调用方取消、超时仍独立区分。ComfyUI 上传/历史/媒体元数据形状错误归一为 502，取得 prompt ID 后会尝试定向取消，取消失败记录日志而不覆盖原始错误。

2026-09-27 的历史工作流测试直接访问 ComfyUI，四条 3 秒原始片段成功不等于生产 `/video/` 包装端点成功；其中双参考 16:9 用时 256.2 秒，超过旧 240 秒生成预算。本轮仅双参考路线改为 270 秒，并将取消清理限制为 10 秒；该值覆盖既有 256.2 秒样本，不能保证负载下成功。生成期限包含上传、排队、采样、下载和媒体校验；超时还要等待最多 10 秒的定向取消清理，HTTP 客户端总超时为 300 秒。真实端点单镜、排队取消、Worker 重启及两期完整成片仍需按共享 GPU 排期单独验收。详细证据与待办见 [PR07 适配审计](../../docs/audit/2026-09-27-pr07-inference-adapter.md)。
