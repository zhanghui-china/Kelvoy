# GX10 审核阶段失败重试上线记录（2026-10-09）

关键帧／视频审核保留正常审核界面，同时显示失败任务阶段、镜号及重试入口。重试复用 `/api/episodes/:id/retry`，单镜已有产物重生成的语义不变；提交期间禁用操作，成功后等待刷新前隐藏重复入口。移除失败后等待 Worker 自动重试的错误提示。

## 发布、备份与回退

- 修复提交 `5c07dcd`，Web 发布目录 `/home/huntun/kelvoy-releases/review-retry-20261009-5c07dcd`，用户级覆盖配置 `kelvoy-web.service.d/98-review-retry.conf`。
- Worker 保留 `storyboard-editing-20261008-837aacf`，Inference 和共享 GPU 服务未修改。
- 备份 `/home/huntun/kelvoy-backups/pre-review-retry-20261009-5c07dcd`（umask 077）：SQLite backup `kelvoy-cutover.db`、`projects-cutover.tar`、素材 SHA256 清单、原服务配置、上线后 HTML 与健康检查。
- 停 Web／Worker 前后均确认 held/pending/processing 任务为 0；数据库 quick_check 为 ok。切换后所有数据库表逐行相同，素材逐文件 SHA256 相同。
- 回退只需维护窗口内停止 Web，移除本次 `98-review-retry.conf`，daemon-reload 后启动 Web；原 97 配置及目录保留。此次无数据库／状态机变更，不需恢复数据库。不要用恢复数据库覆盖上线后的用户数据。

## 验证

- 本地：771 项 Bun 测试、64 项 pytest 通过；五个包 typecheck、ruff、Vite 生产构建通过。pytest 保留已有 Starlette/httpx 弃用告警。
- GX10：770 项 Bun 测试通过、1 项 macOS 专属 ffmpeg 测试跳过；typecheck、生产构建通过。机上测试 PATH 优先 `/usr/bin` 的 ffmpeg，避免 `/usr/local/bin` 中不含 libx264 的版本；复用上一发布的示例素材及现有 Python 环境，未安装或替换系统软件。
- 页面组合测试涵盖关键帧审核、片段审核、两种生成中状态、排队／无失败任务及提交等待；审核界面保留，重试面板不重复。
- API 回归涵盖两个审核阶段，跨账号、版本冲突、余额不足、重复提交均不额外排队或预留积分；只排队第 1 镜，其他七镜和旧成片保留。Worker 模拟生图／视频成功后返回对应审核状态，可继续选图／通过片段；沿用现有失败退款测试。
- 原作品 `e_2ceea195-725c-43b7-a9ae-1632599ebbe9`「黄山 · 黄山」用线上数据库及发布版真实页面组件只读渲染：一个“失败阶段：关键帧 · 第 1 镜”重试入口、7 镜通过、审核 2 保留。产物与数据库未改动；未执行作品重试或整期重新生成。
- Web HTML 引用 `index-bLSMSARE.js`；三个服务 active，Web health 正常，切换窗口无 Web warning 日志。
- 浏览器工具无法连接 Chrome（cgWindowNotFound，浏览器连接列表为空）。线上页面证据来自真实组件渲染及发布 HTML，未完成浏览器交互／视觉验收。

## 真实生成仍受阻

ComfyUI `127.0.0.1:8188/system_stats` 连接被拒绝，无对应监听或可复用的 ComfyUI 用户服务。共享 Visionary 的 bridge 服务存在且仍指向 8188；其运维记录说明生成服务涉及共享 GPU 协调，未找到本体可直接沿用的启动路径。本次未擅自安装、替换或重启共享服务。

**入口已修复，真实生图验收仍受阻。** 需由共享服务负责人恢复并确认 ComfyUI 本体生图能力，再按用户选择执行单镜重试；Inference health 不代表生图可用。参考图手动选择不在本次范围。
