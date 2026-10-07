# GX10 GitHub main 部署记录（2026-10-07）

GX10 `gx10-8e22` 是用户指定的 Kelvoy 主要机器。地址为 `http://100.80.224.95:8888`，通过 Tailscale 访问。

## 当前发布

- GitHub：`https://github.com/zhanghui-china/Kelvoy`，分支 `main`。
- 提交：`a3f69884e397eeb1504823c86e02950de190e3af`（2026-10-07 自首次切换的 `b19ee8140eb5fbd6427690772872d529cd33c0ff` 增量更新，见下）。
- 代码目录：`/home/huntun/kelvoy-releases/main-20261007`，部署工作区干净。
- Web、Worker、Inference 使用原 systemd 用户服务，通过 `90-main-release.conf` drop-in 指向新发布目录。
- 数据库保持 `/home/huntun/kelvoy/apps/web/data/kelvoy.db`，素材保持 `/home/huntun/kelvoy/apps/web/projects`。
- 沿用原受保护配置文件及 Worker 的完整 ffmpeg 工具路径、中文字体配置；未变更其他项目服务。

## 增量更新：a3f6988（2026-10-07）

在同一发布目录 `git merge --ff-only` 到 `a3f6988`，只重启 `kelvoy-web`，未新建发布目录，未动 Worker 和 Inference。

- 运行时代码变化仅 `GET /api/me` 增加 `api_contract`（常量 `API_CONTRACT`，当前 1）；其余为文档、skill 和 ADR 重编号。无依赖、数据库迁移或 unit 文件变化，因此没有 `bun install`，也没有备份数据库。
- Worker 进程内存里仍是 `b19ee81` 的代码；它未使用新常量，两者行为一致，下次正常重启后与磁盘对齐。
- 验证：三个服务 active；`/api/health` 200（本机和 Tailscale 均通过）；匿名 `/api/me` 401 且不含 `api_contract`；重启后一分钟内无 warning 级日志。已登录状态下 `api_contract` 的实际值未在线验证，仅有本地测试覆盖。
- 回退：该目录 `git checkout --detach b19ee81`，再 `systemctl --user restart kelvoy-web`。此更新不涉及数据库，回退不丢数据。
- 本地检查：五个 TS 包类型检查通过，Bun 679 项通过，pytest 64 项通过。

## 备份与回退

备份目录：`/home/huntun/kelvoy-backups/pre-main-20261007`，目录权限受 umask 077 保护。

- `kelvoy-cutover.db`：停止服务后生成的一致性数据库备份，完整性检查通过。
- `projects-cutover.tar`：切换前素材归档。
- `old-deployment.bundle`：旧部署提交 `c8ab053` 的 Git 历史备份。
- 原服务 unit 文件及部署验收脚本、日志保留在该目录。
- 旧代码目录 `/home/huntun/kelvoy` 保留；当前三个服务不再执行其中的代码。

切换脚本在启动或验收失败时自动恢复旧数据库与旧服务路径。以后人工回退需要先暂停三个 Kelvoy 服务并备份升级后的数据，再移走三个 `90-main-release.conf`、用 SQLite backup 恢复 `kelvoy-cutover.db`，执行 `systemctl --user daemon-reload` 后启动服务。只切回旧代码不足以回退数据库迁移。数据库恢复会丢失切换后的业务变更，应先确认。

## 实际验证

- GX10 ARM64：五个 TS 包类型检查通过；677 项 Bun 测试通过，1 项跳过；64 项 Python 测试通过；ruff 与 Vite 生产构建通过。
- 数据库副本先完成主干迁移验证，再迁移线上库；SQLite quick_check 通过。
- 7 个账号、4 个作品全部检查；74 个已引用媒体文件可访问，其中 1 个已完成视频。
- 用户间隔离检查通过；验收临时会话已删除。
- 切换前后作品 JSON、row_version、账号及密码哈希一致。
- 三个服务 active，健康接口及前端通过；本机 Tailscale 访问健康接口通过；切换后检查窗口内无 warning 级服务日志。
- 未创建作品、提交生成任务、改变审核决定或转换旧作品剪辑规则；未验证新版完整 GPU 出片链路。

## 使用变化

- 主干包含固定一秒剪辑、compose_ready、积分预留、资料版本及任务租约机制。
- 旧作品按主干内置读取兼容逻辑处理，未主动转换为固定一秒剪辑。主干不再提供旧部署的 pacing_version=2 长镜规划、无配乐 enabled=false 处理及原单镜 retry 路径；再次编辑、重试或合成应按主干契约核对。
- 7 个账号积分余额均为 0；本次没有擅自发放积分。新生成动作需要通过主干支持的 grant-credits 运维命令设置余额。
- kelvoy-vlog 首版技能仍针对旧 `c8ab053` 契约，尚未适配当前 main，不应直接沿用旧写入流程。
- 发布后磁盘剩余约 38GB，使用率 96%。
