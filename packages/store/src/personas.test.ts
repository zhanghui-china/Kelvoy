import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persona } from "@kelvoy/engine";
import { close, getDb, open } from "./db";
import { getPersona, getPersonaVersion, insertPersona, listPersonas, updatePersona, upsertOfficialPersona } from "./personas";

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

test("official personas appear for every owner and old revisions remain immutable", async () => {
  await insertPersona({ ...fixture("c_official", "u_1"), owner_id: null });
  const first = await getPersonaVersion("c_official", 1);
  await updatePersona("c_official", { name: "新版角色", refs: ["persona/c_official/new.jpg"] });
  expect((await listPersonas("u_2")).map((p) => p.persona_id)).toEqual(["c_official"]);
  expect(await getPersonaVersion("c_official", 1)).toEqual(first);
  expect((await getPersonaVersion("c_official", 2))?.name).toBe("新版角色");
});

test("opening an old database permits official personas and freezes referenced legacy revisions once", async () => {
  close();
  const dir = mkdtempSync(join(tmpdir(), "kelvoy-migrate-"));
  const path = join(dir, "old.db");
  try {
    const old = new Database(path);
    old.exec("create table personas (persona_id text primary key, owner_id text not null, version integer not null default 1, doc text not null, updated_at text not null default (datetime('now')))");
    old.exec("create table episodes (episode_id text primary key, owner_id text not null, row_version integer not null default 1, doc text not null, updated_at text not null default (datetime('now')))");
    old.query("insert into personas (persona_id, owner_id, version, doc) values (?, ?, ?, ?)").run("c_old", "u_1", 3, JSON.stringify({ ...fixture("c_old", "u_1"), version: 3 }));
    old.query("insert into episodes (episode_id, owner_id, doc) values (?, ?, ?)").run("e_old", "u_1", JSON.stringify({ persona_id: "c_old", persona_version: 1 }));
    old.close();
    open(path);
    const frozen = await getPersonaVersion("c_old", 1);
    expect(frozen?.version).toBe(1);
    expect(frozen?.name).toBe("小岛");
    expect(getDb().query<{ compatibility_approximation: number }, []>(
      "select compatibility_approximation from persona_versions where persona_id = 'c_old' and version = 1",
    ).get()?.compatibility_approximation).toBe(1);
    await updatePersona("c_old", { name: "changed" });
    close();
    open(path);
    expect(await getPersonaVersion("c_old", 1)).toEqual(frozen);
    await insertPersona({ ...fixture("c_official", "u_1"), owner_id: null });
    expect((await getPersona("c_official"))?.owner_id).toBeNull();
  } finally {
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("official upsert owns versions, is idempotent, and refuses a private ID", async () => {
  const raw = { ...fixture("c_official", "u_1"), owner_id: null };
  expect((await upsertOfficialPersona(raw)).persona.version).toBe(1);
  expect((await upsertOfficialPersona({ ...raw, version: 99 })).persona.version).toBe(1);
  expect((await upsertOfficialPersona({ ...raw, name: "新版" })).persona.version).toBe(2);
  expect((await getPersonaVersion("c_official", 1))?.name).toBe("小岛");
  await insertPersona(fixture("c_private", "u_1"));
  await expect(upsertOfficialPersona({ ...raw, persona_id: "c_private" })).rejects.toThrow();
});
