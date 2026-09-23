# @kelvoy/cli

内部工具(PRD §2,M1),长期只对内使用,不对外。数据都存本地 SQLite(默认 `data/kelvoy.db`,可用 `KELVOY_DB_PATH` 环境变量指定别的路径,见 `packages/store`,ADR-0004)。

## run

```bash
bun run packages/cli/src/index.ts run <stage> --episode <episode_id>
```

`<stage>` ∈ `brief` / `script` / `assets` / `keyframe` / `video` / `compose`(见 `packages/engine`)。载入期 → 校验能否推进状态 → 跑该阶段 → 乐观锁写回;阶段抛错会尝试标记 `failed`(仅当当前状态是"生成中"状态才合法,`draft` 状态目前标不了,见 `src/run-stage.ts` 注释)。M0 之前各阶段都是占位,一律会失败,这是预期行为。

## import-destination

```bash
bun run packages/cli/src/index.ts import-destination <path.json>
```

校验规则见 `src/validate-destination.ts`,失败会逐条报错、不写库。JSON 格式与检查表见 `docs/guides/M0手册.md` §1。

## import-episode

```bash
bun run packages/cli/src/index.ts import-episode <path.json>
```

手写的期 JSON 校验(`@kelvoy/engine` 的 `validateEpisode`)后写库,同款失败即报错不写库的规矩。`episode_id` 重复会报清晰错误,不会崩。
