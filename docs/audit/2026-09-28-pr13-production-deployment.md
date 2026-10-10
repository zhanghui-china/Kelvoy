# PR13 DGX 生产部署记录

2026-09-28，用户明确授权部署后，在 `spark-c327` 将现有用户级 `kelvoy-web`、`kelvoy-worker`、`kelvoy-inference` 切换至 `/home/Developer/kelvoy-release-9731043`。`comfyui` 保持运行，原 release `/home/Developer/kelvoy-release-848b4a8`、原始仓库及其未提交改动未覆盖。PR #58 仍为 Draft，未合并，未因此执行 GitHub 合并。

## 发布版本

新 release 复制自已经完成两期真实出片、故障恢复、完整备份恢复演练的隔离源码 `2312ea29a2c07fd918af246682e0bc653adddbb6`，保留其已验证的 Bun 依赖、Python 虚拟环境和前端构建。PR #58 已审查 HEAD 为 `97310439d6af12b979b9c7300e5403f974279ff7`；两者之间仅有三份审核文档变化，运行时代码相同。release 内分别保存 `DEPLOY_SOURCE_COMMIT` 和 `REVIEWED_PR_HEAD` 标识。

## 上线前检查与备份

- 切换前生产数据库有 6 个用户、6 期作品、2 个角色、5 个目的地、7 个模板、285 个任务和 555 条积分流水；`pending`、`processing`、`held` 任务合计 0。
- 用 SQLite 备份 API 制作在线副本，在新版本数据层上迁移并重复打开，`quick_check=ok`，上述各表行数不变。在 `127.0.0.1:3302` 用此副本预检新 Web：健康、首页与静态资源为 200，匿名私有作品列表为 401；现有推理服务健康为 200。
- 停止 Worker、Web 和推理服务以暂停写入，重新用 SQLite 备份 API 保存生产库，并完整复制生产媒体目录、复制三项 systemd 单元及 drop-in。备份位于 `/home/Developer/kelvoy-backups/20260928-pr13-9731043`，目录权限 700。备份数据库 `quick_check=ok`；媒体约 1.4 GB，以 `rsync --checksum --dry-run` 确认源和备份一致。既有私有密钥配置文件保持原位，未写入仓库或部署记录。

## 切换与验证

- 仅修改三个用户服务的 `release.conf` 工作目录／命令路径；数据库、媒体仍使用原来的绝对路径。新代码打开生产库并完成迁移，`quick_check=ok`。
- 依次启动推理、Web、Worker。三项服务以及 ComfyUI 均为 `active`；新服务的 `NRestarts=0`。推理 `127.0.0.1:8100/health`、Web `127.0.0.1:8888/api/health`、公网映射 `http://106.13.186.155:8063/api/health` 均为 200。
- 首页和前端 JS/CSS 返回 200；匿名读取私有作品列表返回 401。生产库 `quick_check=ok`，仍有 6 个用户、6 期作品、285 个任务，运行中／待处理／保留任务为 0。两期既有已完成作品的成片文件仍存在；其中一期开启的公开分享 JSON 返回 200，视频 Range 请求返回 206。切换后的 Web、Worker、推理服务错误级 journal 无条目。
- 此次没有在生产环境新建作品或触发生成；两期同角色的真实出片与失败恢复证据见[隔离验收记录](2026-09-28-pr13-dgx-acceptance.md)。

## 回退边界

旧 release 和切换前的完整数据库、媒体、systemd 配置均保留。若新版本接受了新的用户写入，不能直接以切换前数据库覆盖生产库；应先暂停写入并核对新增数据，再制定恢复步骤。此次没有执行生产回滚；已执行的完整备份恢复演练仅针对隔离环境。
