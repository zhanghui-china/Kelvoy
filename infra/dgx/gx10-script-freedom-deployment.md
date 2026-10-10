# GX10 取消脚本创作配额上线记录（2026-10-10）

Web／Worker 已于 2026-10-10 08:42（上海时间）发布 `67e0106`。取消镜数、地标镜头数量、同景别连续次数的限制与告警；首次约 28 镜仅为创作起点，AI 优化可按用户指令增删镜头，提示词不再给镜头类型数量配比。首页显示“镜数自由”。继续生成仍要求至少一镜，并保留字段、场景、地标引用、内容审核及任务期间编辑锁。

## 发布、备份与回退

- 功能提交 `67e01067567459011d0d6b4b290c1fca60be4d2f`；发布目录 `/home/huntun/kelvoy-releases/script-freedom-20261010-67e0106`。本地功能和发布记录合入 main，未推送 GitHub。
- Web／Worker 使用用户级 `zzz-script-freedom.conf`。原 `zz-system-diagnostics.conf` 及旧发布目录保留；Inference 继续使用 `system-diagnostics-20261009-975a81e`，未重启或修改运行环境。
- 无数据库迁移；保留 `storyboard_warnings` 接口字段，返回空数组。数据库和项目素材根目录保持不变。
- 成功切换备份 `/home/huntun/kelvoy-backups/pre-script-freedom-20261010T004208Z-67e0106`（umask 077）：一致性 SQLite backup `kelvoy-cutover.db`、`projects-cutover.tar`、素材 SHA256 清单、原三个服务配置、受保护环境配置、切换脚本及验收结果。
- 固定运维白名单仍为原 7 个用户 ID，受保护配置文件 SHA256 不变。临时新账号未加入白名单。
- 发布包使用已提交的精简源码和五份工作流测试夹具。已有示例素材复制至新目录，并逐文件核对当前提交的 SHA256；片头片尾按 Git LFS 指针中的真实内容散列校验，保留实际视频文件。新目录创建独立 Python 环境用于验证，未链接或同步任何旧环境。
- 回退：确认队列空闲、停止 Web／Worker，移除或移走本次两个 `zzz-script-freedom.conf`，daemon-reload 后启动原服务。无需恢复数据库或素材，避免覆盖上线后用户数据。

## 验证与验收

- 本地：856 项 Bun、100 项 pytest 全部通过；五个包类型检查、ruff、Vite 生产构建通过。保留已有 Starlette/httpx 弃用告警。
- GX10：855 项 Bun 通过、1 项 macOS 专属 ffmpeg 测试跳过；100 项 pytest、类型检查、ruff、生产构建通过。使用既有 libx264 ffmpeg，没有修改共享 GPU 软件。
- 模拟 LLM 回归：1／10／23／31／40 镜、全部同景别且无地标，首次返回仅调用一次；优化从 26 镜返回 3 镜；提示词允许增删且无配额／类型配比。非法字段、地标引用和违规内容仍拒绝或进入原有纠正流程。
- Worker 暂停期间运行 `verify-script-freedom.ts`：真实 HTTP 验收 1／10／23／31／40 镜无地标、连续同景别、无告警且可继续；空脚本、非法场景／地标／字段和违规内容不能继续。
- 同窗口运行原 `verify-storyboard.ts`：双账号首尾／中间插镜、排序、删除、字幕编辑、版本冲突、队列锁、免费手工修改、选择性视频预留、私有 AI 建议队列及旧成片／分享保留全部通过。
- 验收只创建临时私有作品和合成素材，Worker 全程暂停；临时账号、会话、作品、任务、积分及合成素材全部清理。结束时所有业务表逐行与备份一致，素材完整文件清单及 SHA256 一致，quick_check=ok，账号为 7，held/pending/processing 为 0。未执行真实 LLM／GPU 生成任务。
- 切换后三服务 active/running、NRestarts=0；Web／Inference health 正常，启动窗口 warning 日志为 0。Tailscale 健康检查通过，新资源 `/assets/index-NtT5dh59.js` 包含“镜数自由”。本次 UI 证据来自构建、组件回归与线上静态资源，没有执行真实浏览器交互验收。

## 发布过程中的修正

- 独立验证首次发现素材散列差异，原因是本地片头片尾为 Git LFS 指针而旧发布目录为真实媒体；改按 LFS 声明的内容散列校验后完全一致。精简包另补齐 pytest 引用的第五份工作流夹具，随后全套验证通过。
- 首次切换脚本将 Worker 正常暂停时 `systemctl is-active` 的退出码 3 误判为异常，自动移除本次 drop-in 并恢复旧 Web／Worker；尚未运行临时作品验收。该次备份保留于 `pre-script-freedom-20261010T004131Z-67e0106`。修正退出码处理、核实原服务正常后重新备份并成功切换，无用户数据或素材变更。
