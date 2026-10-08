# GX10 自由分镜上线记录（2026-10-08）

Web／Worker 已发布自由分镜：首尾追加、中间插入、编辑画面及字幕、删除、拖动或按钮排序。初始约 28 镜作为创作起点，手工数量自由且免费；生成队列空闲时可以修改已有脚本，未受影响素材保留。单镜 AI 补全先返回建议，由用户确认插入。

## 发布与备份

- 运行提交 `837aacf`，发布目录 `/home/huntun/kelvoy-releases/storyboard-editing-20261008-837aacf`。本地 main 已快进合入功能，未推送 GitHub。
- Web／Worker 使用用户级 `97-storyboard-editing.conf`，此前 96、95、90 配置保留；Inference 不变。
- SQLite `/home/huntun/kelvoy/apps/web/data/kelvoy.db`；素材 `/home/huntun/kelvoy/apps/web/projects`。
- 备份 `/home/huntun/kelvoy-backups/pre-storyboard-editing-20261008-837aacf`，权限 umask 077。停 Web／Worker、确认 held/pending/processing 队列为空后，备份 `kelvoy-cutover.db`（344 KiB）、`projects-cutover.tar`（232 MiB）及服务配置、验收日志。
- 增加稳定 shot_id、任务 shot_id/payload_json/result_json/error 列。历史镜头和任务回填稳定身份，原镜号及全部素材路径保持原值；在副本和切换备份上分别连续执行两次迁移，原各表内容（扣除新增身份字段）相同、重复迁移无变化、quick_check 通过。
- API 契约升为 2，PRD、API 文档、操作手册及生产技能同步。

## 验证

- 本地功能分支及合入 main：760 项 Bun 测试、64 项 pytest 通过，五个包 typecheck、ruff、Vite 生产构建通过。
- GX10：759 项 Bun 测试通过，1 项 macOS 专属 ffmpeg 测试跳过；64 项 pytest、typecheck、ruff、生产构建通过。保留已有 Starlette/httpx 弃用告警。
- 模拟提供方端到端：keyframe 和 references 两种路径，已完成作品插入／排序／删除后只补生成新镜头，原视频保留，新合成成功才更新分享分镜；资源检查失败重试能继续使用已选关键帧，仅预留视频费用。
- 真实线上 HTTP 双账号：首尾和中间插镜、排序、删除、字幕修改、版本冲突、跨账号拒绝、生成队列锁定、手工零费用、新镜头选择性视频预留、私有 AI 建议队列。上一版下载／分享继续使用旧镜序和字幕。
- Worker 暂停期间运行 verify-storyboard.ts、verify-persona-deletion.ts、verify-shared-destinations.ts，全通过。临时账号与所有关联数据清理后，各业务表与迁移后的切换备份逐表相同、quick_check 通过。
- 三个服务 active，Tailscale health ok；页面引用新版 index-usBVTJ1k.js，启动检查窗口 warning 日志为 0。
- 未执行真实 LLM／GPU 出片；AI 输出验证使用模拟 HTTP，线上只验收队列与权限。未完成浏览器交互／视觉验收：当前工具无可用浏览器连接，前端证据来自测试、构建、线上 HTML 与 HTTP。

## 运维与回退

验收脚本要求 Worker 暂停及 KELVOY_VERIFY_WORKER_PAUSED=1，并设置数据库、素材根目录和 KELVOY_VERIFY_BASE_URL。只清理脚本创建的临时账号，结束后恢复 Worker。

切换脚本失败会移除本次两个 97 drop-in、daemon-reload、启动原服务；此次未触发回退。旧代码没有稳定 ID、选择性生成和旧分享快照语义，上线后有自定义分镜时应优先向前修复。确需回退先暂停任务并进入维护窗口，评估新数据兼容性；不要直接恢复旧数据库或删除历史素材，数据库恢复涉及上线后数据损失时需另行确认。
