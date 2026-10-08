# GX10 共享目的地上线记录（2026-10-08）

GX10 `gx10-8e22` 当前 Web／Worker 已更新为共享目的地版本，入口：[目的地库](http://100.80.224.95:8888/destinations)。

## 发布版本与范围

- 运行提交：`a53d8cd`，功能分支 `feat/shared-destination-drafts`，由本机 Git 增量 bundle 部署；未 push GitHub，GitHub main 未因此改变。
- 独立发布目录：`/home/huntun/kelvoy-releases/shared-destinations-20261008-a53d8cd`，Git 工作区干净。
- Web、Worker 增加 `95-shared-destinations.conf` 用户级 systemd drop-in 指向新目录，原 `90-main-release.conf` 保留。
- 数据库仍为 `/home/huntun/kelvoy/apps/web/data/kelvoy.db`，素材仍为 `/home/huntun/kelvoy/apps/web/projects`，端口仍为 8888；原环境配置保持。
- Inference 保持原发布目录及运行进程，Python、模型、GPU 和其他项目服务未变更。
- 增加 `sharp@0.35.5`；GX10 使用 frozen lockfile 安装 Linux ARM64 原生包并验证真实解码，不复制 macOS 原生依赖。

## 备份和迁移

备份目录：`/home/huntun/kelvoy-backups/pre-shared-destinations-20261008-a53d8cd`（umask 077）。

- `kelvoy-cutover.db`：短暂停止 Kelvoy Web／Worker 后生成的一致性数据库备份，264 KiB，quick_check 通过。
- `projects-cutover.tar`：同一暂停窗口的素材备份，209 MiB。
- `service-units-before.txt`、各项检查日志、验收日志、迁移副本和切换前数量快照保留。
- 先在数据库副本执行两次 `open()`：新增 destination_drafts 表，原有全部业务表内容完全一致，quick_check 两次为 ok；上线后再核对既有表内容与 cutover 备份完全一致。
- 发布前任务无 pending／running；验收期间 Worker 暂停，验收清理完成后恢复。未运行 GPU 生成。

## 验证

- 本机与 GX10：704 项 Bun 测试、64 项 pytest、五个 TS 包 typecheck、ruff、Vite 生产构建通过。pytest 保留已有 Starlette／httpx 弃用告警。
- 新增测试覆盖草稿隔离、非创建者拒绝、非法／损坏图片、容量与数量限制、路径与符号链接、并发上传、数据库／文件写入故障清理、发布完整性、重复发布、编辑冲突和历史照片。
- 线上实际 HTTP 双账号流程通过：创建私有草稿 → 上传四张实景图片 → 发布前另一账号和公共接口不可访问 → 发布／重复发布 → 另一账号可查看照片、选择并 POST 建期 → 创建者编辑草稿移除一张照片、发布 v2 → 旧期仍读取 v1 和已移除历史照片。
- 验收用两个临时账号；临时积分只用于建期契约验证，随后账号、会话、草稿、目的地、版本、期、队列任务、积分记录与上传目录全部清理。创建／上传／发布前后的创建者积分为 0。
- 验收后原有全部表数据与备份一致；15 张现有公开目的地照片仍返回 200，数据库 quick_check 为 ok，三个服务 active。
- 本机 Tailscale `/api/health` 返回 ok，`/destinations` 返回新版前端；检查窗口内 Web／Worker warning 日志为 0。
- 浏览器视觉和交互验收未完成：当前电脑使用工具无可用浏览器连接，Chrome 原生窗口控制报 cgWindowNotFound。前端验证为测试、类型检查、构建及真实 HTTP 流程，不声称已执行完整浏览器流程。

复用 HTTP 验收脚本：`infra/dgx/verify-shared-destinations.ts`。在仓库根目录设置线上 `KELVOY_DB_PATH`、`KELVOY_PROJECTS_ROOT` 和 `KELVOY_VERIFY_BASE_URL`，先暂停 Worker，再显式设置 `KELVOY_VERIFY_WORKER_PAUSED=1` 执行。脚本只清理自己创建的临时账号及其数据；完成后恢复 Worker。

## 回退

原目录 `/home/huntun/kelvoy-releases/main-20261007` 保留。需回退时暂停 Web／Worker，先备份升级后的数据库与素材，移走两个服务的 `95-shared-destinations.conf` 并执行 daemon-reload，服务将恢复原 `90-main-release.conf` 路径。不要直接删除新表／上传文件或恢复旧数据库，否则会丢失上线后用户数据。

旧版本通用素材接口未检查私有草稿引用，回退旧代码前必须保全并隔离新产生的未发布照片（移到 projects 根目录外的受保护备份位置），防止其被旧接口读取；已发布版本及照片须保留。上线后有真实用户数据时，优先修复并向前发布；数据库恢复需要单独确认数据损失范围。本次切换脚本在验收失败时恢复原服务路径；实际所有检查通过，未触发回退。
