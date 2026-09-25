# services/inference

常驻的本地推理服务,被 `apps/worker` 通过 HTTP 在本机/内网调用,不对公网开放。

对应 PRD §7 的四个模型环节:`llm`(脚本/分镜 + 角色一致性文字侧)、`image`(关键帧 + 角色一致性图像侧)、`video`(图生视频)、`upscale`(放大/修复)。常驻加载权重,避免每次冷启动;GPU 按环节分配的比例待 M0 实测后定(PRD §9)。

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
`/video/` 使用 MiniMax H3 的首帧图生视频工作流，`params.duration_s` 可设为 3、4、5 秒。
两者读取 `comfyui-bridge` 中的 API 工作流文件，调用 `KELVOY_COMFYUI_BASE_URL`
（默认 `http://127.0.0.1:8188`）。请求里的 `refs` 必须是
`KELVOY_PROJECTS_ROOT` 下的相对路径；结果也保存到该目录的 `inference/` 下。
每次请求只生成一个候选，客户端需要多候选时须发起多次请求并保存各自的 seed。
当前图片原生尺寸约 768×1376，视频为 480×864；最终 1080×1920 仍需后期放大。

DGX 的 `kelvoy-inference.service` 需要设置
`Environment=KELVOY_PROJECTS_ROOT=/home/Developer/kelvoy/apps/web/projects`，
并从仓库根目录保留 `comfyui-bridge` 工作流。图像和视频生成超时设为 240 秒；
调用方现有的 300 秒超时更长，给响应传输留出了时间。
