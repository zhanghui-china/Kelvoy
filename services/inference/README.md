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
