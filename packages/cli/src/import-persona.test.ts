import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getPersona, getPersonaVersion, open } from "@kelvoy/store";
import { importOfficialPersona } from "./import-persona";

const raw = {
  persona_id: "c_official_test", owner_id: null, version: 12, name: "测试角色", desc: "虚构人物",
  locked: ["脸型"], default_outfit: "衬衫",
  refs: ["persona/c_official_test/front.jpg", "persona/c_official_test/side.jpg", "persona/c_official_test/full.jpg"],
  style: { lut: "warm", title_style: "simple" },
};

beforeEach(() => open(":memory:"));
afterEach(() => close());

test("imports only valid official personas and lets the store own revisions", async () => {
  expect((await importOfficialPersona({ ...raw, owner_id: "u_1" })).ok).toBe(false);
  expect((await importOfficialPersona({ ...raw, refs: raw.refs.slice(0, 2) })).ok).toBe(false);
  expect(await getPersona(raw.persona_id)).toBeNull();
  const { version: _version, ...withoutVersion } = raw;
  const first = await importOfficialPersona(withoutVersion);
  const same = await importOfficialPersona(raw);
  const changed = await importOfficialPersona({ ...raw, name: "新版" });
  expect(first.ok && first.persona.version).toBe(1);
  expect(same.ok && same.persona.version).toBe(1);
  expect(changed.ok && changed.persona.version).toBe(2);
  expect((await getPersonaVersion(raw.persona_id, 1))?.name).toBe("测试角色");
});
