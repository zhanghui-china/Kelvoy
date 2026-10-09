# GX10 关键帧画面描述保存上线记录（2026-10-09）

Web 已修复画面描述保存按钮错误依赖 `canRegen` 的问题。`failed`、`kf_selected`、`kf_ready`、`approved` 均可保存；未修改时成功并留在当前审核，修改时沿用原 API 返回脚本审核，仅目标镜头素材引用失效。保存不会触发生成。

## 发布、备份与回退

- 修复提交 `73219cd`，发布目录 `/home/huntun/kelvoy-releases/description-save-20261009-73219cd`；Web 使用用户级 `99-description-save.conf`。
- Worker、Inference 的服务配置、运行目录与版本不变。维护窗口暂停 Web／Worker，验收结束后恢复 Worker；未重启 Inference 或共享 GPU 服务。
- 切换前后确认 held/pending/processing 队列为 0。备份 `/home/huntun/kelvoy-backups/pre-description-save-20261009-73219cd`（umask 077）：SQLite backup `kelvoy-cutover.db`、`projects-cutover.tar`、素材 SHA256 清单、原服务配置、健康检查与验收日志。
- 切换及临时账号验收清理后，所有业务表逐行与备份相同，全部素材 SHA256 和完整文件清单相同，SQLite quick_check 为 ok。
- 旧 `98-review-retry.conf` 和旧发布目录保留。回退需维护窗口停止 Web，移除 `99-description-save.conf`，daemon-reload 后启动 Web；不需要恢复数据库或素材，避免覆盖上线后的用户数据。

## 验证与验收范围

- 本地：791 项 Bun 测试、64 项 pytest、五个包 typecheck、ruff、Vite 生产构建通过；保留已有 Starlette/httpx 弃用告警。
- GX10：790 项 Bun 测试通过，1 项 macOS 专属 ffmpeg 测试跳过；64 项 pytest、typecheck、ruff、生产构建通过。使用现有 `/home/huntun/.local/bin` 的 libx264 ffmpeg，仅用于测试；复用旧发布示例素材，上传当前提交的 workflow JSON 测试夹具，未安装或修改 GPU 软件。
- 前端渲染回归覆盖四种镜头状态和任务忙碌、脚本任务、非审核阶段、提交等待锁定；客户端测试覆盖 PATCH 内容／版本及网络错误。保存使用同步 ref 防重复提交、显示“保存中…”，失败不关闭编辑框或清空输入；这些动态交互尚缺真实浏览器验收。
- 运行 `infra/dgx/verify-description-save.tsx`：临时私有作品上，四种状态均验证未修改重复保存和修改后保存；跨账号拒绝、版本冲突、空描述校验；其他镜头、旧成片及历史文件保留；保存没有生成队列。脚本要求 Worker 暂停、显式设置数据库与素材路径，仅清理其自身临时数据。
- 原黄山作品 `e_2ceea195-725c-43b7-a9ae-1632599ebbe9` 只读：第 1 镜为 failed，真实页面组件的编辑／保存按钮均可用；没有 PATCH 原作品或触发生图。
- Web HTML 引用 `index-Dtz9hB7Y.js`；三个服务 active，Web health 正常。
- Chrome 工具仍返回 `cgWindowNotFound`，浏览器连接列表为空。页面证据来自真实组件只读渲染、生产构建、线上 HTML 与 HTTP，未完成点击、输入、保存等待、防重复提交及失败保留输入的浏览器交互／视觉验收。

## 验证过程中的推理环境引用变更

- 首次 GX10 Python 验证误将暂存目录 `.venv` 链接到现有 `/home/huntun/kelvoy/services/inference/.venv` 并执行 `uv run`。uv 更新了 editable 包路径引用；当前 `_editable_impl_kelvoy_inference.pth` 和 `direct_url.json` 指向本次新发布的 `services/inference`。后续只读核查确认同时新增 Pillow 12.3.0，其他已安装包版本与旧目录锁文件一致；此次更新不是仅路径元数据变化。
- 只读逐文件核对确认：新目录推理 Python 源码与正在运行的 `main-20261007` 完全相同；Inference 未重启、仍为 active。新目录保留，不删除，以免环境引用悬空。
- 后续验证使用独立环境副本、显式 PYTHONPATH 和 `uv run --no-sync`，已通过全部 Python 检查。
- 自动审批拒绝对现有根推理环境执行恢复用的 `uv sync --frozen`，理由是可能修改运行服务使用的环境。已告知用户并请求授权核查及恢复；当前恢复待授权，不能把环境引用恢复标记为完成。


### 用户授权只读核查结果（2026-10-09）

- 用户授权核查，未授权恢复；本次核查未执行同步、安装、删除或服务重启。
- 运行进程 PID 2546 的实际启动命令是 `main-20261007/services/inference/.venv/bin/python`，工作目录同属 `main-20261007`。该环境与旧工作目录及新发布目录的 `.venv` inode 各不相同，确认为独立环境。
- 运行环境的 editable `.pth` 与 `direct_url.json` 仍指向 `main-20261007/services/inference`。新进程只读导入也定位到该目录；已安装包全部符合运行版本锁文件，没有锁文件外包，发布时段没有 dist-info 更新。推理服务自 2026-10-08 10:37:44 UTC 起运行，未在本次发布期间重启；Web／Inference health 均正常。
- 受影响的是旧工作目录 `/home/huntun/kelvoy/services/inference/.venv`：editable 包引用被改为本次新发布目录，并新增 Pillow 12.3.0。两个对应 dist-info 目录修改时间均为 2026-10-09 01:12:44 UTC；没有已安装包版本偏离旧目录锁文件，锁文件间也没有包版本升级或降级。
- 旧工作目录的推理源码、pyproject 和 uv.lock 与当前运行版本不同；新发布版本的源码、pyproject 和 uv.lock 与当前运行版本相同。因此不得将旧目录的 `uv sync --frozen` 当作恢复当前运行环境的方法。
- 恢复仍未执行。应保持新发布目录存在，防止旧环境的引用悬空；若后续授权恢复，应先明确旧环境的目标用途和原包引用，再只处理该旧环境。
