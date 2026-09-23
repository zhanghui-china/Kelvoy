# @kelvoy/cli

内部工具(PRD §2,M1),长期只对内使用,不对外。

```bash
bun run packages/cli/src/index.ts run <stage> --episode <episode_id>
```

`<stage>` ∈ `brief` / `script` / `assets` / `keyframe` / `video` / `compose`(见 `packages/engine`)。

Episode 怎么从 Postgres + 对象存储读写还没接,目前只是占位。
