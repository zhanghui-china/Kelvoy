# 长镜主干双节点部署（2026-10-10）

用户在本地主干合并后明确要求“推送，然后部署到2个节点”。`main` 已推送至 GitHub，两台节点均使用源码提交 `cffada2dce78c12b45eaa1f7ee51cd5e839cecb2` 的独立发布目录，包含长镜实现 `e772b15` 及字幕、阶段回看提交 `d1ead12`。部署记录后续提交仅修改文档。

## 版本与结果

| 节点 | 入口 | 验证完成时间（北京时间） | 切换前作品／任务／素材文件 |
| --- | --- | --- | --- |
| GX10 `gx10-8e22` | http://100.80.224.95:8888（Tailscale） | 2026-10-10 17:46:35 | 7／138／211 |
| `spark-c327` | http://106.13.186.155:8063 | 2026-10-10 17:40:10 | 10／378／1054 |

两台节点 Web、Worker、Inference 均 `active/running`，验证时 `NRestarts=0`。本地访问两个对外 `/api/health` 均返回 `{"status":"ok"}`，节点内 Inference `/health` 正常，ComfyUI 可访问。原服务配置、环境文件和运维配置逐文件 SHA-256 校验一致；新增 systemd 用户服务 drop-in 仅覆盖工作目录和启动程序。

源码包 `long-20261010T0940-cffada2.tar.gz`（约 27 MiB），SHA-256：

```text
ca6780bb81dd00fb743215fa9c335abae82ba64071221a0065467dbcf1d08437
```

包包含 647 个受版本控制的运行源码、资源和文档文件，`RELEASE.json` 记录源码提交与逐文件哈希。排除历史测试输出 `.codex-q21-test/` 和 `comfyui-bridge/output_image/`，不包含生产数据库、账号配置或密钥。两台分别校验包及文件，独立安装锁定依赖、创建推理虚拟环境，不修改模型或 GPU 驱动。

## 验证与数据保留

两节点均重新执行 `make typecheck`、`make test`、`bun run build`、`make lint`。Linux 为 950 个 Bun 测试通过、1 个平台条件跳过、0 失败；Python 100 个通过，仅既有 Starlette/httpx 弃用警告。本地 macOS 的 951 个 Bun 测试全部通过。

生产 SQLite 只读备份在节点内用于新版启动演练，现有表、列与每条记录一致，无数据库迁移或新增字段。切换暂停服务后再备份数据库和全部素材，恢复 Web 后、恢复 Worker 前再次比较全部数据库记录与素材哈希，通过生产 HTTP 临时双账号验收（字幕默认／保存／冲突／归属、旧成片读取、字幕编辑保留片段），清理仅验收自建的数据。前端资源确认包含字幕设置与阶段回看。

GX10 首次切换在前置检查发现 ComfyUI 作业活跃而退出，没有改变服务版本。随后暂停 Worker 接取任务，等待现有 ComfyUI 作业结束，再暂停 Web／Inference、备份与切换。13 条原有待处理／处理中任务保持原记录，未手动修改任务、积分或租约；等待原租约过期后恢复新版 Worker，继续处理用户原有队列。恢复前数据与素材完全一致；恢复后的合法任务执行会继续写入数据库和新素材，不能把暂停期间的一致性结果理解为队列恢复后数据库仍静止。部署验收没有提交生成或合成任务。

spark-c327 没有待执行任务；恢复三个服务后数据库与全部素材仍校验一致。

旧长镜兼容验证使用节点内保护的数据库副本，没有把完整生产作品导出到本地。spark-c327 的 3 个旧长镜作品均尚未完成全部片段生成；副本读取、字幕编辑与建议时长／已有片段／旧成片保留通过。已有片段子集的真实探测计划在原配乐切点下明确报告预算冲突，不降级为 1 秒或 2 秒。没有据此声称这 3 个未完成作品已经可以成功合成，没有重新生成生产作品。GX10 无旧长镜作品。实现与真实色块 FFmpeg 验收详见 [主干验收](../../docs/testing/long-shots-main-2026-10-10.md)。

## 发布目录与备份

| 节点 | 发布目录 | 备份目录 |
| --- | --- | --- |
| GX10 | `/home/huntun/kelvoy-releases/long-20261010T0940-cffada2` | `/home/huntun/kelvoy-backups/pre-long-20261010T0940-cffada2` |
| spark-c327 | `/home/Developer/kelvoy-releases/long-20261010T0940-cffada2` | `/home/Developer/kelvoy-backups/pre-long-20261010T0940-cffada2` |

备份权限限制在节点账号内，包含 `kelvoy-cutover.db`、`projects-cutover.tar`、原服务配置、配置与媒体哈希、逐表数据库校验摘要、HTTP 验收日志和 `deployment.json`。旧发布目录 `latest-20261010T132317-1ee992b` 保留。

## 回退

在相应节点账号中，先暂停接取任务，确认其 GPU 作业结束并安全停止服务，再移除本次新增的三个 drop-in。不要删除旧配置或直接恢复数据库覆盖部署后的用户操作。

```bash
systemctl --user stop kelvoy-web kelvoy-worker kelvoy-inference
for svc in kelvoy-web kelvoy-worker kelvoy-inference; do
  rm "$HOME/.config/systemd/user/$svc.service.d/zzzzzzz-long-20261010.conf"
done
systemctl --user daemon-reload
systemctl --user start kelvoy-inference kelvoy-web kelvoy-worker
```

原 drop-in 会重新选择旧发布路径。恢复后检查三个服务及健康接口；本次没有数据库迁移，正常代码回退不需要恢复数据库和素材。备份用于异常恢复，恢复前必须评估部署之后产生的数据。
