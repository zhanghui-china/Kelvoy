# Qwen 图片提示词增强回退（2026-10-10）

取消本轮增强接入，当前分支以新提交保留历史，代码、配置、测试及 PRD 恢复至 `e0e85b8`；仅增加此记录及 README 链接。删除编写器、缓存契约、来源字段、内部改写路由、开关、官方增强代码、下载／启动／验收工具与详细证据。既有 H3、ComfyUI 与生图 Qwen 保留。本轮增强未启用生产，真实改写验收失败；没有部署、生产重启、数据库恢复、真实出图、推送或合并主分支。

GX10 清理前确认增强服务 inactive／disabled、无子进程或打开文件、无其他用户服务配置依赖。卸载 `kelvoy-qwen-pe.service` 及 `backend.conf` drop-in，删除 `/home1/huntun/kelvoy-qwen-pe`，执行用户级 daemon-reload。目录占用与文件系统实际释放均为 **25,779,564,544 字节（25.78 GB，24.01 GiB）**；可用空间从 158,123,016,192 增至 183,902,580,736 字节。本机删除本轮 33 个专用临时文件（549,594 文件字节）；GX10 `/tmp` 无本轮 Qwen 残留。

清理后服务 LoadState=not-found，8110 无监听，专用目录、服务文件、drop-in 和增强子进程不存在。生产 Web／Worker／Inference 仍 active/running、NRestarts=0，PID 分别为 `147599`／`147675`／`66434`；Web／Worker 发布目录仍为 `h3-prompt-20261010-cf00d16`，Inference 仍为 `system-diagnostics-20261009-975a81e/services/inference`。Web／Inference health 均 ok，ComfyUI 可访问且队列为空。未修改共享环境、驱动、业务数据库、原黄山作品或固定 7 人白名单。

本地验证：874 项 Bun、100 项 Python 测试通过，五包类型检查、ruff 和生产构建通过。Bun 在受限环境中有 19 项 loopback 监听失败，允许监听后全套通过；Python 保留既有 Starlette/httpx 弃用告警。对照 `e0e85b8` 的代码与配置无差异，应用不再引用增强路由、开关、编写器或来源字段。
