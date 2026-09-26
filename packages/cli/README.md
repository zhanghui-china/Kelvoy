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

## import-template

```bash
bun run packages/cli/src/index.ts import-template <path.json>
```

模板校验(`@kelvoy/engine` 的 `validateTemplate`)后写库,同款失败即报错不写库的规矩。`owner_id: null` 是官方模板,写非空字符串是用户私有模板。存在则覆盖(upsert,不像 destination/episode 那样报重复)。

## 官方角色与首批目录

```bash
bun run packages/cli/src/index.ts import-persona <path.json>
bun run packages/cli/src/index.ts seed-catalog
```

`import-persona` 只接收 `owner_id: null` 的完整角色 JSON，参考图必须有 3–7 张且路径在 `persona/<persona_id>/` 下。`version` 可省略；即使提供也由 store 决定，内容未变不升级，有变更才保存新版本。导入不会写图片文件；更新参考图时先以新文件名放到 `KELVOY_PROJECTS_ROOT`（默认 `projects`），旧文件保留供已有期使用。浏览器无官方角色写权限。

`seed-catalog` 将 `assets/demo/` 中的 21 张演示参考图复制到项目素材根目录，导入两位官方虚构角色和五个真实目的地。不创建账号或期。重复运行跳过相同文件与记录；文件内容冲突、目的地 ID 冲突、角色初始版本 ID 冲突会报错，不覆盖现有内容。运营后续更新官方角色由 `import-persona` 完成，重跑 seed 不会撤销更新。照片来源、作者与许可见 `assets/demo/README.md`。
