# Worker 一镜技术验收（2026-09-25）

在 `spark-c327` 的提交 `a3bfceb` 上，用独立 SQLite 库
`/tmp/e_smoke_1790316890830.db` 和现有非正式测试图调用真实 Worker、推理服务与 ComfyUI。
测试角色图与地标图各重复填入三次，只用于验证接口及状态流，不构成 PRD 的三张独立参考图或画质验收。

| 环节 | 结果 |
| --- | --- |
| assets | 校验参考图后推进到 `keyframing`，自动入队一镜任务 |
| keyframe | 生成两张 768×1376 PNG，归档到 `projects/e_smoke_1790316890830/kf/`，进入 `kf_review` |
| 人工选择模拟 | 从两个候选中选择第一张，通过现有 `patchShot`/`patchEpisode` 推进到 `clipping` |
| video | 生成 H.264、480×864、24 fps、3.041667 秒 MP4，归档到 `clip/`，进入 `clip_review` |

镜记录已包含模型名、工作流哈希、seed、参考图 SHA-256 和尝试次数。
Web、Worker、推理服务保持 `active`，ComfyUI 队列恢复空闲。

这次使用隔离库，未向正式期数据库写入测试角色、目的地或期。正式角色和实拍地标的保真评审仍待完成；多镜并发、拒片重生成、最终成片亦未在本次技术验收中覆盖。
