# infra/migrations

按 ADR-0003：不用迁移框架，纯 `.sql` 文件，序号即顺序。本地跑（`infra/docker-compose.local.yml` 起的 Postgres）：

```bash
psql "$DATABASE_URL" -f infra/migrations/0001_destinations.sql
```

后续迁移新建 `000N_<name>.sql`，只增不改——已发布的文件不回头改字段，要改就新写一个迁移文件。
