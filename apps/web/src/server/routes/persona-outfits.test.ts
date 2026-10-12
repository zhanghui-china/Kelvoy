import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, createSession, createUser, getPersona, insertPersona, open } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Persona } from "@kelvoy/engine";
import { Hono } from "hono";
import outfits from "./persona-outfits";
import personas from "./personas";

const persona = (id: string, ownerId: string | null): Persona => ({
  persona_id: id, owner_id: ownerId, version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["persona/front.png", "persona/side.png", "persona/full.png"], style: { lut: "x", title_style: "y" },
});
const app = () => { const a = new Hono(); a.route("/api/personas", personas); a.route("/api/personas", outfits); return a; };
const png = (n = "a.png") => new File([new Uint8Array([1, 2, 3])], n, { type: "image/png" });

async function login(username: string) {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("collision");
  const session = await createSession(created.user.user_id);
  return { cookie: `kelvoy_session=${session.session_id}`, ownerId: created.user.user_id };
}
function form(fields: Record<string, string | string[]>, files: File[]): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  for (const file of files) f.append("files", file);
  return f;
}

let tmpRoot: string;
beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-outfits-api-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
});
afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

async function create(cookie: string, personaId: string, files = [png()], fields: Record<string, string | string[]> = { name: "秋日风衣", desc: "米色", seasons: ["秋", "冬"] }) {
  return app().request(`/api/personas/${personaId}/outfits`, { method: "POST", headers: { cookie }, body: form(fields, files) });
}
const stored = async (id: string) => (await readdir(join(tmpRoot, "projects", "persona", id)).catch(() => [])).length;

test("creates an outfit with 1 image, bumping the persona version", async () => {
  const { cookie, ownerId } = await login("o1");
  await insertPersona(persona("c_1", ownerId));
  const res = await create(cookie, "c_1");
  expect(res.status).toBe(201);
  const body = await res.json() as { persona: Persona };
  expect(body.persona.version).toBe(2);
  expect(body.persona.outfits?.[0]).toMatchObject({ name: "秋日风衣", seasons: ["秋", "冬"] });
  expect(body.persona.outfits?.[0]?.refs.length).toBe(1);
  expect(await stored("c_1")).toBe(1);
});

test("rejects 0 and 4 images, bad type and missing name without leaving files", async () => {
  const { cookie, ownerId } = await login("o2");
  await insertPersona(persona("c_1", ownerId));
  expect((await create(cookie, "c_1", [])).status).toBe(400);
  expect((await create(cookie, "c_1", [png(), png(), png(), png()])).status).toBe(400);
  const gif = new File([new Uint8Array([1])], "a.gif", { type: "image/gif" });
  expect((await create(cookie, "c_1", [gif])).status).toBe(400);
  expect((await create(cookie, "c_1", [png()], { name: "" })).status).toBe(400);
  expect(await stored("c_1")).toBe(0);
  expect((await getPersona("c_1"))?.version).toBe(1);
});

test("another account and official personas get 404", async () => {
  const { cookie } = await login("o3");
  await insertPersona(persona("c_other", "u_someone"));
  await insertPersona(persona("c_official", null));
  expect((await create(cookie, "c_other")).status).toBe(404);
  expect((await create(cookie, "c_official")).status).toBe(404);
  expect((await create(cookie, "c_missing")).status).toBe(404);
});

test("patch, append, delete round trip; refs cannot be patched", async () => {
  const { cookie, ownerId } = await login("o4");
  await insertPersona(persona("c_1", ownerId));
  const made = await (await create(cookie, "c_1")).json() as { outfit: { outfit_id: string } };
  const id = made.outfit.outfit_id;
  const json = { cookie, "content-type": "application/json" };
  const patched = await app().request(`/api/personas/c_1/outfits/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ name: "新名" }) });
  expect(patched.status).toBe(200);
  const forged = await app().request(`/api/personas/c_1/outfits/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ refs: ["persona/x.png"] }) });
  expect(forged.status).toBe(400);
  const appended = await app().request(`/api/personas/c_1/outfits/${id}/refs`, { method: "POST", headers: { cookie }, body: form({}, [png(), png()]) });
  expect(appended.status).toBe(201);
  const over = await app().request(`/api/personas/c_1/outfits/${id}/refs`, { method: "POST", headers: { cookie }, body: form({}, [png()]) });
  expect(over.status).toBe(400);
  expect(await stored("c_1")).toBe(3); // the refused upload was removed again
  const gone = await app().request(`/api/personas/c_1/outfits/${id}`, { method: "DELETE", headers: { cookie } });
  expect(gone.status).toBe(200);
  expect((await getPersona("c_1"))?.outfits).toEqual([]);
  expect(await stored("c_1")).toBe(3); // files stay: older versions still reference them
  expect((await app().request(`/api/personas/c_1/outfits/${id}`, { method: "DELETE", headers: { cookie } })).status).toBe(404);
});

test("a seventh outfit is refused with 409 and its file is removed", async () => {
  const { cookie, ownerId } = await login("o5");
  await insertPersona(persona("c_1", ownerId));
  for (let i = 0; i < 6; i++) expect((await create(cookie, "c_1")).status).toBe(201);
  expect((await create(cookie, "c_1")).status).toBe(409);
  expect(await stored("c_1")).toBe(6);
});
