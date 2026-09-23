import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Persona } from "@kelvoy/engine";
import { close, open } from "./db";
import { getPersona, insertPersona, listPersonas, updatePersona } from "./personas";

function fixture(id: string, ownerId: string): Persona {
  return {
    persona_id: id,
    owner_id: ownerId,
    version: 1,
    name: "小岛",
    desc: "30 岁男性，短发",
    locked: ["脸型", "发型", "体态"],
    default_outfit: "浅灰亚麻衬衫",
    refs: ["persona/front.png", "persona/side.png", "persona/full.png"],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("returns null for a missing persona", async () => {
  expect(await getPersona("c_missing")).toBeNull();
});

test("round-trips an inserted persona", async () => {
  await insertPersona(fixture("c_1", "u_1"));
  const result = await getPersona("c_1");
  expect(result?.name).toBe("小岛");
  expect(result?.version).toBe(1);
});

test("listPersonas only returns the given owner's personas", async () => {
  await insertPersona(fixture("c_1", "u_1"));
  await insertPersona(fixture("c_2", "u_1"));
  await insertPersona(fixture("c_3", "u_2"));

  const mine = await listPersonas("u_1");
  expect(mine.map((p) => p.persona_id).sort()).toEqual(["c_1", "c_2"]);
});

test("updatePersona merges the patch and bumps version, ignoring any caller-supplied version", async () => {
  await insertPersona(fixture("c_1", "u_1"));
  const result = await updatePersona("c_1", {
    default_outfit: "换了件外套",
    // @ts-expect-error deliberately trying to smuggle a version through
    version: 999,
  });
  expect(result.ok).toBe(true);
  expect(result.ok && result.persona.version).toBe(2);
  expect(result.ok && result.persona.default_outfit).toBe("换了件外套");
  // unrelated fields untouched
  expect(result.ok && result.persona.name).toBe("小岛");

  const stored = await getPersona("c_1");
  expect(stored?.version).toBe(2);
});

test("updatePersona returns not_found for a missing persona", async () => {
  const result = await updatePersona("c_missing", { default_outfit: "x" });
  expect(result).toEqual({ ok: false, error: "not_found" });
});
