# GX10 角色编辑／删除上线记录（2026-10-08）

GX10 Web／Worker 已发布角色删除功能，入口：[角色库](http://100.80.224.95:8888/personas)。自己的角色卡片保留编辑，增加带角色名称和历史保留说明的删除确认；官方角色只可使用。删除后不能用于新期，旧期继续读取冻结版本及私有照片，不扣积分。

## 发布与备份

- 运行提交：`af9e261`，发布目录 `/home/huntun/kelvoy-releases/persona-deletion-20261008-af9e261`，Git 工作区干净。增量 bundle 部署，未 push GitHub。
- Web／Worker 使用 `96-persona-deletion.conf` 用户级 systemd drop-in。此前 `95-shared-destinations.conf` 保留。Inference 及 GPU 服务保持原路径。
- 数据库 `/home/huntun/kelvoy/apps/web/data/kelvoy.db`，素材 `/home/huntun/kelvoy/apps/web/projects`。
- 备份 `/home/huntun/kelvoy-backups/pre-persona-deletion-20261008-af9e261`，umask 077；停 Web／Worker 后备份数据库 `kelvoy-cutover.db`（284 KiB）、素材 `projects-cutover.tar`（216 MiB），另保留切换前服务配置和验证日志。
- SQLite 增加可空 `personas.deleted_at`。上线前在副本连续执行两次迁移，原有各表全部列值不变、新增列全空、quick_check 通过。

## 验证结果

- 本机：713 项 Bun 测试、64 项 pytest、五个包 typecheck、ruff、Vite 生产构建通过。
- GX10：712 项 Bun 测试通过，1 项 macOS 专属 ffmpeg 测试跳过；64 项 pytest、typecheck、ruff、生产构建通过。pytest 保留已有 Starlette／httpx 弃用告警。
- 真实 HTTP 双账号验收：创建／上传／编辑、旧版本删除 409、跨账号及官方角色删除 404、当前版本删除及重复请求成功；删除后目录不可见、编辑／上传／建期 404，积分不变；旧期继续读取冻结版本和图片，另一账号无法读取私有图片。
- Worker 暂停期间运行 `infra/dgx/verify-persona-deletion.ts` 和共享目的地验收脚本，均通过，不执行 GPU 出片。临时账号、会话、角色、版本、期、队列、积分和上传目录均清理，原有全部业务表内容与切换前备份一致，数据库完整性通过。
- Web／Worker／Inference 三个服务 active；Tailscale 健康接口 ok，角色页引用新版前端；检查窗口 Web／Worker warning 为 0。
- 浏览器视觉验收未完成：当前工具无可用浏览器连接，此前原生 Chrome 控制报 cgWindowNotFound。以上前端证据来自测试、构建、线上 HTML 和真实 HTTP 验收，不声称完成浏览器交互验收。

## 运维与回退

复用验收脚本前暂停 Worker，设置线上 `KELVOY_DB_PATH`、`KELVOY_PROJECTS_ROOT`、`KELVOY_VERIFY_BASE_URL` 和 `KELVOY_VERIFY_WORKER_PAUSED=1`。脚本仅清理自己创建的临时账号数据，结束后恢复 Worker。

上一个共享目的地发布目录仍保留。发布失败时切换脚本会移除本次两个 `96-persona-deletion.conf`，daemon-reload 并恢复之前 Web／Worker；本次未触发回退。真实用户已经删除角色后，旧代码会忽略 deleted_at、使删除角色重新可选，因此应优先向前修复；如需代码回退，先进入维护窗口并保留软删除过滤，再恢复服务。不要直接恢复旧数据库或删除版本／照片，避免丢失上线后用户数据。需要恢复数据库时另行确认数据损失范围。
