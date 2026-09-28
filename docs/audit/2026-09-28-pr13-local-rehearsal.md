# PR13 本地集成预演（2026-09-28）

本记录只针对合并后的代码和一次性临时夹具。运行 `bun scripts/pr13-local-rehearsal.ts`，脚本创建旧结构 SQLite，保持写连接打开且已提交数据仍在 WAL 文件中，再从另一只读连接用 `VACUUM INTO` 做一致性备份。脚本仅打开备份的第二个副本进行应用启动迁移。退出时删除所有临时库。未访问部署环境数据库、项目媒体目录或 GPU。

| 检查 | 结果 |
|---|---|
| 旧库、备份、迁移后、重启后、回滚副本的 `integrity_check` | `ok` |
| 作品、角色、目的地、任务、用户核心行数与原有字段内容 | 升级前后均各 1 行；主键排序后的原字段投影在备份、迁移、重启、回滚副本中逐项相同 |
| 活跃 WAL 中的数据 | 备份时 WAL 非空、源连接保持打开；备份副本内容与源库相同 |
| 缺失历史角色和目的地版本 | 各生成 1 个带 `compatibility_approximation=1` 的冻结快照 |
| 旧作品读取默认值 | 候选数 2、画幅 9:16、剪辑策略 `beat_aligned` |
| 第二次打开迁移副本 | 一次性迁移标记仍只有 1 条，核心记录原字段内容不变 |
| 从备份复制回旧库结构 | 完整性和核心记录原字段内容通过，不含新迁移标记 |
| 原始旧库和备份 | 前后 SHA-256 不变 |

相关权限、分享和旧数据路由测试共 103 项通过，包括非本人作品 404、私人角色和素材隔离、分享开关、老成片下载、旧逐镜转换及审核接口所有者限制。复跑命令：

```sh
bun test apps/web/src/server/routes/episodes.test.ts apps/web/src/server/routes/share.test.ts apps/web/src/server/routes/assets.test.ts apps/web/src/server/routes/episodes-review.test.ts packages/store/src/legacy-cuts.test.ts packages/store/src/personas.test.ts packages/store/src/destinations.test.ts
make typecheck
bun run --cwd apps/web build
```

五个 workspace 类型检查和 Web 生产构建通过。这些是本地夹具及测试结果，不表示真实服务的权限或成片下载已验收。

部署前仍须对真实服务库及 `projects/` 做完整备份，记录核心表和文件校验值，并在**隔离副本**运行本脚本同等级检查；本脚本目前只提供确定性旧库夹具演练，不接收真实数据库路径。若升级后已有积分流水或新作品写入，应停写并修复现库，不能直接用旧备份覆盖这些新记录。本地脚本本身不覆盖两期真实作品、横竖屏媒体、下载分享、失败恢复或服务启停；这些已在授权的[DGX 隔离验收](2026-09-28-pr13-dgx-acceptance.md)中另行验证。现有部署的数据备份、迁移、回滚与正式发布仍未执行，不能由本地预演或隔离测试标记为完成。
