# @kelvoy/cli

内部工具(PRD §2,M1),长期只对内使用,不对外。

```bash
bun run packages/cli/src/index.ts run <stage> --episode <episode_id>
```

`<stage>` ∈ `brief` / `script` / `assets` / `keyframe` / `video` / `compose`(见 `packages/engine`)。

Episode 怎么从 Postgres + 对象存储读写还没接,目前只是占位。

## import-destination

```bash
DATABASE_URL=postgres://kelvoy:kelvoy@localhost:5432/kelvoy \
  bun run packages/cli/src/index.ts import-destination <path.json>
```

校验规则见 `src/validate-destination.ts`,失败会逐条报错、不写库。JSON 格式与检查表见 `docs/guides/M0手册.md` §1。本地库表由 `infra/migrations/0001_destinations.sql` 建（见 ADR-0003）。
