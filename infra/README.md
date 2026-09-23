# infra/

按 PRD §9 的云/本地分工:

- **云端**(国内云,备案域名):Postgres、Redis 队列、对象存储(OSS/MinIO)。具体云厂商与部署方式待定。
- **本地**(DGX):容器编排、模型权重管理。见 `dgx/README.md`。

`docker-compose.local.yml` 只用于本地开发(起一份 Postgres/Redis/MinIO 让 `apps/web`/`apps/worker` 能连),不是生产拓扑。
