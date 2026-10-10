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

## 官方 Qwen 图片提示词增强

内部 `GET /image/rewrite/metadata/` 返回缓存必须使用的固定版本信息。
`POST /image/rewrite/` 接收 `context`（`mode: "edit"`、`aspect: "9:16" | "16:9"`、
中文 `kf_prompt` 和镜头上下文）、按角色／场景顺序排列的 `refs` 项目内相对路径、
对应的 `expected_ref_hashes` SHA256 列表。返回 `prompt`、`wh_ratio`、空 `ratio_follow`、
`reference_hashes` 和 `metadata`；不会返回或保存思考内容。

固定上游代码、配套系统提示词与校验散列在
`src/inference/vendor/qwen_pe/manifest.json`，固定上游仓库代码与模型 checkpoint 的许可证均为 Qwen Research License，
仅允许非商业研究／评估，商用需要另行获得商业许可。
两个来源的许可原文分别保存在 `LICENSE` 与 `MODEL_LICENSE`，来源 URL 和散列
在 manifest 中保留，`Notice` 保留许可要求的归属声明。
运行时只读取这些本地文件，不下载代码或权重。图片预处理、消息构造、答案解析直接调用
未修改的官方 `pe_core.py`，部署前必须验证权重 revision 与 manifest 一致。

默认关闭增强。独立模型服务准备好后设置 `KELVOY_IMAGE_REWRITE_ENABLED=true`；
`KELVOY_IMAGE_REWRITE_URL` 默认 `http://127.0.0.1:8110/v1`，模型服务需要提供
OpenAI SSE `chat/completions`，启用 thinking，限制并发为 1。Inference 也串行调用，
官方 edit 采样参数固定在 manifest 中。所有格式纠正与排队共享 900 秒总期限，
只允许纠正一次；超时、断开连接、图片变更、格式或画幅错误均拒绝出图，绝不降级提交原稿。

`POST /image/` 仍只接收最终 prompt，可附带 `expected_ref_hashes`，提交前核对参考图，
上传同一份已核对的不可变字节，避免核对后替换文件导致参考图悄然改变。
