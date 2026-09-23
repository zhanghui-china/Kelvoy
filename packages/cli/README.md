# @kelvoy/cli

内部工具(PRD §2,M1),长期只对内使用,不对外。

```bash
bun run packages/cli/src/index.ts run <stage> --episode <episode_id>
```

`<stage>` ∈ `brief` / `script` / `assets` / `keyframe` / `video` / `compose`(见 `packages/engine`)。

Episode 怎么从 `@kelvoy/store` 读写、跑起流水线,还没接,目前只是占位。

## import-destination

```bash
bun run packages/cli/src/index.ts import-destination <path.json>
```

写到本地 SQLite(默认 `data/kelvoy.db`,可用 `KELVOY_DB_PATH` 环境变量指定别的路径,见 `packages/store`,ADR-0004)。校验规则见 `src/validate-destination.ts`,失败会逐条报错、不写库。JSON 格式与检查表见 `docs/guides/M0手册.md` §1。
