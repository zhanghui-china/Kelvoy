#!/usr/bin/env bun
/**
 * 审片台（#31）的演示数据装载脚本。一次性脚本，spike/ 不 lint 不测。
 *
 *   bun run spike/fixtures/load.ts <username>
 *
 * 干三件事：把目的地/模板/角色写进库，然后把同目录下四个期 JSON 的
 * owner_id/persona_id 换成这个账号的真实 id 再导入。为什么不用
 * `packages/cli import-episode`：那条命令按 JSON 里写死的 owner_id 导入，
 * 而 owner_id 是建账号时随机生成的，只有换掉才能在网页里看到这几期（想手
 * 动走 CLI 也行，自己把 JSON 里的 u_demo/c_demo 替换掉即可）。
 *
 * 上游模型还没接（#26/#27 不在范围内），所以 kf/*.png、clip/*.mp4、
 * grid/*.png 这些产物文件并不存在——审片台对加载失败的图/视频显示"文件未
 * 生成"占位，这正是真实环境里"还在生成中"的样子。
 */
import { join } from "node:path";
// spike/ 不是 bun workspace 的成员（workspaces 只有 apps/* 和 packages/*），
// 所以这里按相对路径 import，不走 @kelvoy/* 包名。
import type { Destination, Episode, Persona, Template } from "../../packages/engine/src/index";
import { checkScriptRules, validateEpisode } from "../../packages/engine/src/index";
import {
  getUserByUsername,
  insertEpisode,
  insertPersona,
  open,
  upsertDestination,
  upsertTemplate,
} from "../../packages/store/src/index";

const EPISODE_FILES = [
  "episode-script-review.json",
  "episode-kf-review.json",
  "episode-clip-review.json",
  "episode-done.json",
];

const here = import.meta.dir;
const read = (name: string) => Bun.file(join(here, name)).json();

const username = process.argv[2];
if (!username) {
  console.error("usage: bun run spike/fixtures/load.ts <username>");
  process.exit(1);
}

open();

const user = await getUserByUsername(username);
if (!user) {
  console.error(`账号 ${username} 不存在，先跑 packages/cli 的 create-user`);
  process.exit(1);
}

const destination = (await read("destination-lingshan.json")) as Destination;
const template = (await read("template-scenic-area.json")) as Template;
const persona = { ...((await read("persona-demo.json")) as Persona), owner_id: user.user_id };

await upsertDestination(destination);
await upsertTemplate(template);
await insertPersona(persona);
console.log(`目的地 ${destination.destination_id} / 模板 ${template.template_id} / 角色 ${persona.persona_id} 已写入`);

for (const file of EPISODE_FILES) {
  const raw = (await read(file)) as Episode;
  const result = validateEpisode({ ...raw, owner_id: user.user_id, persona_id: persona.persona_id });
  if (!result.valid) {
    console.error(`${file} 校验失败：`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  const violations = checkScriptRules(result.value.shots, destination);
  if (violations.length > 0) {
    console.error(`${file} 不符合 FR-02：`);
    for (const v of violations) console.error(`  - ${v.message}`);
    process.exit(1);
  }
  await insertEpisode(result.value);
  console.log(`已导入 ${result.value.episode_id}（${result.value.status}，${result.value.shots.length} 镜）`);
}
