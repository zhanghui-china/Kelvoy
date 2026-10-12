import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Persona, PersonaOutfit } from "@kelvoy/engine";
import { close, open } from "./db";
import {
  addPersonaOutfit, appendOutfitRefs, canReadPersonaAsset, getPersona, getPersonaVersion, insertPersona,
  patchPersonaOutfit, removePersonaOutfit,
} from "./personas";

const base = (): Persona => ({
  persona_id: "c_1", owner_id: "u_1", version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["persona/c_1/base.png"], style: { lut: "x", title_style: "y" },
});
const outfit = (id: string, refs = [`persona/c_1/${id}.png`]): PersonaOutfit =>
  ({ outfit_id: id, name: id, desc: "", seasons: ["秋"], refs });
const ids = { persona_id: "c_1", owner_id: "u_1" };

beforeEach(async () => { open(":memory:"); await insertPersona(base()); });
afterEach(() => close());

test("add bumps the version and old revisions keep their own outfits", async () => {
  const added = addPersonaOutfit({ ...ids, outfit: outfit("o_1") });
  expect(added.ok && added.persona.version).toBe(2);
  expect((await getPersonaVersion("c_1", 1))?.outfits).toBeUndefined();
  expect((await getPersona("c_1"))?.outfits?.map((o) => o.outfit_id)).toEqual(["o_1"]);
});

test("add rejects a seventh outfit and a wrong image count", () => {
  for (let i = 0; i < 6; i++) expect(addPersonaOutfit({ ...ids, outfit: outfit(`o_${i}`) }).ok).toBe(true);
  expect(addPersonaOutfit({ ...ids, outfit: outfit("o_6") })).toEqual({ ok: false, error: "too_many_outfits" });
});

test("add rejects 0 or 4 images", () => {
  expect(addPersonaOutfit({ ...ids, outfit: outfit("o_a", []) })).toEqual({ ok: false, error: "invalid_ref_count" });
  expect(addPersonaOutfit({ ...ids, outfit: outfit("o_b", ["1", "2", "3", "4"]) }))
    .toEqual({ ok: false, error: "invalid_ref_count" });
});

test("patch changes text only; append respects the 3-image cap; remove drops it from latest only", async () => {
  addPersonaOutfit({ ...ids, outfit: outfit("o_1") });
  const patched = patchPersonaOutfit({ ...ids, outfit_id: "o_1", patch: { name: "改名", seasons: ["冬"] } });
  expect(patched.ok && patched.outfit?.name).toBe("改名");
  expect(patched.ok && patched.outfit?.refs).toEqual(["persona/c_1/o_1.png"]);
  expect(appendOutfitRefs({ ...ids, outfit_id: "o_1", refs: ["x", "y"] }).ok).toBe(true);
  expect(appendOutfitRefs({ ...ids, outfit_id: "o_1", refs: ["z"] })).toEqual({ ok: false, error: "invalid_ref_count" });
  expect(appendOutfitRefs({ ...ids, outfit_id: "o_9", refs: ["z"] })).toEqual({ ok: false, error: "outfit_not_found" });
  const removed = removePersonaOutfit({ ...ids, outfit_id: "o_1" });
  expect(removed.ok && removed.persona.outfits).toEqual([]);
  // The revision before removal still lists the outfit with all three images.
  expect((await getPersonaVersion("c_1", 4))?.outfits?.[0]?.refs.length).toBe(3);
});

test("another owner and unknown persona get not_found", () => {
  expect(addPersonaOutfit({ persona_id: "c_1", owner_id: "u_2", outfit: outfit("o_1") }))
    .toEqual({ ok: false, error: "not_found" });
  expect(removePersonaOutfit({ persona_id: "c_x", owner_id: "u_1", outfit_id: "o_1" }))
    .toEqual({ ok: false, error: "not_found" });
});

test("outfit images are readable by the owner, also after the outfit is removed", async () => {
  addPersonaOutfit({ ...ids, outfit: outfit("o_1") });
  expect(await canReadPersonaAsset("c_1", "persona/c_1/o_1.png", "u_1")).toBe(true);
  expect(await canReadPersonaAsset("c_1", "persona/c_1/o_1.png", "u_2")).toBe(false);
  removePersonaOutfit({ ...ids, outfit_id: "o_1" });
  expect(await canReadPersonaAsset("c_1", "persona/c_1/o_1.png", "u_1")).toBe(true);
  expect(await canReadPersonaAsset("c_1", "persona/c_1/nope.png", "u_1")).toBe(false);
});
