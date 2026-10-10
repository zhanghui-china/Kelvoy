# 作品永久删除双节点发布（2026-10-10）

## 发布内容与包

发布包 `delete-20261010-v2` 基于 `1441cc8`，包含当前工作区的作品删除实现；源码清单 `RELEASE.json` 校验 673 个文件。归档 SHA-256 为 `374558fb03196192813d67f5be1429738dcd31addf451193184b15b1b6971088`。首次上线使用已验证的工作区源码包；后续提交与推送 main 时，核对两节点应用源码与提交一致，并将版本写入发布目录的 `DEPLOYED_COMMIT` 与 `RELEASE.json`。该绑定不改变应用运行内容。

新增 store 内部审计表 `episode_deletions`、执行令牌表 `task_executions`，迁移标识 `episode_deletions_v1`。不扩充作品状态枚举。SQL 留在 store，目录清理留在 Worker。Inference 源码未改，其服务及既有 Python 环境继续使用；新发布目录链接既有虚拟环境以执行测试。

接口、约束与恢复边界见 [删除接口说明](../../docs/api/episode-deletion.md)，自动测试和浏览器覆盖见 [验收记录](../../docs/testing/episode-deletion-20261010.md)。

## spark-c327

- 发布目录：`/home/Developer/kelvoy-releases/delete-20261010-v2`。
- 备份：`/home/Developer/kelvoy-backups/pre-delete-20261010-v2/`，包含 `kelvoy-cutover.db`、`projects-cutover.tar`、素材 SHA-256 清单和原 Web／Worker 配置。首次备份 1054 个文件；回退验收后的重新备份 1056 个文件，多出的两项均为本次独立测试素材，随后已清理。
- 切换前队列无 pending／processing 任务。停止 Web／Worker 后完成数据库和素材备份；新空库与生产副本各重复迁移两次。恢复 Web 后，核对原数据库表的原字段与全部素材 hash 完全一致，再执行测试作品验收，最后启动 Worker。
- 预检：五包 typecheck 通过，Bun 996 通过／1 项现有无 ASS 或 drawtext 的 FFmpeg 测试跳过，Python 105 通过，ruff 与构建通过。远端使用生产服务 PATH 内的 FFmpeg 和既有虚拟环境，未安装 uv 或改变推理依赖。
- 独立作品 `e_verify_delete_0568b4c2-e5be-4bc9-84b6-559f39c9fa8a` 实测：重复请求只退款一次、分享／下载／详情立即 404、消费总计保留、目录实际清理为 done、另一测试作品不受影响。两期测试作品最终均删除，测试账号删除，审计记录保留。
- 首次切换的配置与已有 `zzzzzzzz-video-timeout-20261010.conf` 前缀相同，按文件名排序被旧配置覆盖。HTTP 验收发现 404 后自动回退，原服务健康。改用九个 z 的 `zzzzzzzzz-episode-deletion-20261010.conf`，并增加 Web／Worker WorkingDirectory 断言，第二次切换成功。首次失败遗留的两期独立测试作品已按精确 ID 通过新删除流程清理。
- Web、Worker、Inference 均 active；Web／Worker NRestarts 均为 0，运行目录确认指向新包。

## GX10

- 发布目录：`/home/huntun/kelvoy-releases/delete-20261010-v2`。
- 经 Tailscale 传输完整归档速度较低，改为在新发布目录复制旧包中 hash 完全一致的文件，传输 38 个差异文件（102250 字节）；随后核验完整清单 673 个文件全部一致。中断的完整包上传不用于发布。
- 备份：`/home/huntun/kelvoy-backups/pre-delete-20261010-v2/`，包括 SQLite 备份、246 个媒体文件的 hash 清单与素材归档，以及原覆盖配置。
- 切换前 pending／processing 为零。重复迁移、原有数据库字段／记录和全部素材 hash 比较通过，再启动 Web 验收，最后启动 Worker。
- 独立作品 `e_verify_delete_af97e14b-0150-41c5-a9ba-1d111091beb4` 实测退款一次、立即撤销详情／分享／下载、历史统计保留、真实目录清理完成，另一作品文件保留。测试作品与账号最终清理，审计保留。
- 预检：五包 typecheck 通过；Bun 996 通过／1 项与 spark 相同的现有 FFmpeg 能力测试跳过；Python 105 通过；ruff 与生产构建通过。
- 复查：`episode_deletions_v1` 存在，两条测试删除记录均 done，健康接口 200；Web、Worker、Inference 均 active，Web／Worker NRestarts 均为 0，进程目录指向新发布包。

## 回退

Web 和 Worker 分别新增覆盖文件 `~/.config/systemd/user/<service>.service.d/zzzzzzzzz-episode-deletion-20261010.conf`。回退时停止这两个服务，仅移除本轮文件，`systemctl --user daemon-reload` 后启动 Web，原发布配置即生效；Inference 不切换。旧 Worker 缺少取消和清理保护，若存在未完成删除，应保持 Worker 暂停，使用兼容版本完成 pending 清理后再恢复任务执行。

保留新增审计表与积分流水，不用发布前数据库备份覆盖在线数据库，不恢复已经删除的作品。生产备份沿用原有保留策略。素材清理仅处理明确删除的作品，不扫描或删除历史孤立目录。若需恢复删除功能，应重新启用本包 Web／Worker，以继续 pending 清理。
