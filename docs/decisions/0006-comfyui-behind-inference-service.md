# 0006 · ComfyUI 工作流接在现有推理服务之后

- **Date**: 2026-09-25
- **Status**: Accepted for technical integration; production model choice remains gated by M0

## Context

同事新增的 `comfyui-bridge/` 提供 Qwen-Image 2.1 与 MiniMax-H3 的 UI/API 工作流，以及 Flask HTTP 包装。Kelvoy 已有 Worker → `services/inference` 的 JSON 协议与 5 分钟调用超时，`packages/engine` 的图像/视频 provider 仍是占位。

Spark 上 ComfyUI 已常驻 `8188`，所需模型和主要自定义节点齐备。双参考图技术样片实测成功。新增的 Flask 服务在 Spark 上没有依赖，现有 API JSON 还含 UI 辅助节点与隐式连线，不能未经校验直接提交给 ComfyUI。文档默认 16:9/3:4、15 秒，也不符合 PRD 固定 9:16、3–5 秒的约束。

## Decision

- `services/inference` 继续作为 Worker 唯一的模型协议入口；由它调用本机 ComfyUI 的 `/prompt`、`/history`、`/view`，对外维持 `/image`、`/video` 的请求/响应形状。Web 不直连 ComfyUI。
- 先接入经过技术实测的双参考关键帧与首帧生视频 API 工作流；单角色参考图工作流也做接口适配，但正式素材的质量验收仍待完成。图像角色和地标参考图由 Worker 按期与目的地选择；推理服务只接收受限的相对 key，在配置的 `projects_root` 内解析，拒绝越界和不支持的格式。生成文件由 Worker 归档到期目录。
- 显式传 9:16 与 3–5 秒，不沿用桥接服务的默认参数。模型、工作流哈希/版本、seed、输入参考图哈希、耗时和错误阶段必须回写到镜记录；SQLite 仍是期与任务状态唯一真源。
- 桥接器的工作流 JSON 和节点映射作为上游资产使用，不把 1347 行 Flask 服务直接并入 FastAPI，也不增加第二个永久对外 HTTP 服务。M0 测试脚本可直接调用 ComfyUI，但生产调用必须经过 `services/inference`。
- `SolAttnMiniMax` 在本节点的视频采样中触发原生崩溃，当前候选 API 工作流移除此节点，并保留可用的 MiniMax 内存优化、LoRA、模型与采样器。若后续换节点版本，必须用同样的 9:16、5 秒样片复测。
- 单镜超时、取消、重试和国内 API 溢出由 Worker 控制。ComfyUI 任务若超时或 Worker 取消，需按 prompt ID 中断或删除，避免超时后继续占 GPU。排队时间与推理时间分开计量。

## Alternatives

- **直接常驻 Flask 桥接器，Worker 调它**：能少写一层 ComfyUI 客户端，但会形成与现有 `services/inference` 并行的协议、额外依赖/进程和同步长请求；拒绝作为生产主线。
- **Worker 直接调 ComfyUI**：省一个跳转，却把模型节点和文件协议泄漏到 Worker，破坏现有边界；拒绝。

## Consequences and verification

- 需要一个小而聚焦的 ComfyUI 客户端、输入 key 校验、模型参数映射和模拟 ComfyUI 的协议测试。
- 生产路径的可用性依赖本机 ComfyUI；推理服务健康检查要区分自身存活与 ComfyUI 不可用。
- M0 仍须用正式角色和实拍目的地素材验证跨镜一致性、地标保真、耗时及成本；技术样片不能替代 PRD §10 验收。
