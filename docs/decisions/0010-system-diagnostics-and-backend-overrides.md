# ADR-0010：全站后端覆盖与只读系统检测

状态：已采纳（2026-10-09）

设置页需要判断 Worker → Inference → ComfyUI 的静态依赖与连接状态，并允许明确指定的运维人员切换全站 ComfyUI 地址。个人 UserSettings 不承载基础设施配置，不新增管理员角色。

## 决策

- `@kelvoy/store` 唯一拥有 SQLite 单例 `system_config`。Web 认证后以部署变量 `KELVOY_OPERATOR_USER_IDS` 精确匹配用户 ID，空白名单没有修改权限。普通用户只能检测当前配置并获取简化结果。
- Web 与 Worker 使用同一 `INFERENCE_BASE_URL`。Inference 负责从推理机器只读访问 ComfyUI 与 bridge；bridge 是共享伴随服务，故障不代表 Kelvoy 生成链路故障。Web 检测证明当前请求可达，Inference `/health` 仅检查进程响应，不声称检查 Worker 进程。
- 两个可空覆盖地址和版本号作为统一测试／保存载荷。null 由 Inference 继承部署环境，Web 不推断远端机器的继承地址；运维诊断结果显示解析后的实际地址。保存前重新检查 ComfyUI system_stats 与 queue 格式，缺节点、模型或 bridge 故障不阻止接口可达的后端保存。
- 保存采用即时 SQLite 事务：复核版本并检查全站 held/pending/processing 任务。事务与任务入队／领取的写事务串行，因此检测期间入队也阻止保存。任务开始时冻结配置覆盖、版本与 Inference 地址；缓存标识包含这些信息。修改不重写已有媒体与素材。
- 覆盖地址只能为无凭据、无查询／片段的 HTTP(S) URL。Web 与 Inference 分别检查部署 origin 白名单，Inference 对继承诊断地址也检查。默认白名单为空，诊断与生成均不能访问目标；发布前须明确加入现有继承地址。禁止跟随重定向。白名单属于部署配置，UI 无法修改。
- 诊断总时限 15 秒，每个下游请求最多 5 秒，无重试；相同并发请求合并但不缓存已完成结果。仅使用 GET system_stats、queue、object_info、health；不上传、不创建／取消任务、不清队列、不消费积分。

## 限制与运维

静态检查不证明模型能加载或实际出图。环境变量变更需要相应服务重启；若只更换 Inference 的继承 ComfyUI 地址而不修改 SQLite 配置，Worker 无法获知远端环境改变。应在队列空闲时用保存／恢复继承递增配置版本使缓存失效，或同时更改 Inference 地址；部署步骤见 `infra/dgx/gx10-system-diagnostics-deployment.md`。Inference 内网接口沿用现有可信网络边界，不应直接暴露互联网。

新增表不修改原数据，老版本可以忽略该表；回滚必须同时回滚 Web、Worker、Inference，旧 Worker 不识别覆盖值。发布与数据库备份必须在队列空闲时进行。
