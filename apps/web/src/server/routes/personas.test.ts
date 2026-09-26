import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, createSession, createUser, getPersona, insertPersona, open } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Persona } from "@kelvoy/engine";
import { Hono } from "hono";
import personas from "./personas";

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

function createRequestBody() {
  return {
    name: "小岛",
    desc: "30 岁男性，短发",
    locked: ["脸型", "发型", "体态"],
    default_outfit: "浅灰亚麻衬衫",
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/personas", personas);
  return app;
}

async function login(username: string): Promise<{ cookie: string; ownerId: string }> {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("unexpected username collision in test");
  const session = await createSession(created.user.user_id);
  return { cookie: `kelvoy_session=${session.session_id}`, ownerId: created.user.user_id };
}

function pngFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

let tmpRoot: string;

beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-personas-api-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
});

afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

test("requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/personas");
  expect(res.status).toBe(401);
});

test("only returns the logged-in user's own personas", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(fixture("c_mine", ownerId));
  await insertPersona(fixture("c_someone_elses", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/personas", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; personas: Persona[] };
  expect(body.personas.map((p) => p.persona_id)).toEqual(["c_mine"]);
});

test("creates a persona with zero reference images", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/personas", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(createRequestBody()),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; persona: Persona };
  expect(body.persona.refs).toEqual([]);
  expect(body.persona.version).toBe(1);
});

test("browser cannot forge official ownership on create or patch", async () => {
  const { cookie, ownerId } = await login("owner-spoof");
  const app = buildApp();
  const created = await app.request("/api/personas", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...createRequestBody(), owner_id: null, version: 88, persona_id: "c_official_spoof" }),
  });
  expect(created.status).toBe(201);
  const body = await created.json() as { persona: Persona };
  expect(body.persona.owner_id).toBe(ownerId);
  expect(body.persona.version).toBe(1);
  expect(body.persona.persona_id).not.toBe("c_official_spoof");
  const patched = await app.request(`/api/personas/${body.persona.persona_id}`, {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "changed", owner_id: null, persona_id: "c_official_spoof", version: 88 }),
  });
  expect(patched.status).toBe(200);
  expect((await getPersona(body.persona.persona_id))?.owner_id).toBe(ownerId);
});

test("rejects a malformed create request", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/personas", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "小岛" }),
  });
  expect(res.status).toBe(400);
});

test("patch bumps version and rejects touching refs", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(fixture("c_mine", ownerId));
  const app = buildApp();

  const patchRes = await app.request("/api/personas/c_mine", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ desc: "换了个发型" }),
  });
  expect(patchRes.status).toBe(200);
  const patched = (await patchRes.json()) as { ok: boolean; persona: Persona };
  expect(patched.persona.version).toBe(2);
  expect(patched.persona.desc).toBe("换了个发型");

  const refsRes = await app.request("/api/personas/c_mine", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ refs: ["x.png"] }),
  });
  expect(refsRes.status).toBe(400);
});

test("patching someone else's persona 404s", async () => {
  const { cookie } = await login("dannei");
  await insertPersona(fixture("c_theirs", "u_someone_else"));
  const app = buildApp();

  const res = await app.request("/api/personas/c_theirs", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ desc: "试图改别人的角色" }),
  });
  expect(res.status).toBe(404);
});

test("official personas are listed but browser patch and upload return 404", async () => {
  const { cookie } = await login("official-reader");
  await insertPersona({ ...fixture("c_official", "u_other"), owner_id: null });
  const app = buildApp();
  const listed = await app.request("/api/personas", { headers: { cookie } });
  expect((await listed.json() as { personas: Persona[] }).personas[0]?.persona_id).toBe("c_official");
  const patched = await app.request("/api/personas/c_official", { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "hack" }) });
  expect(patched.status).toBe(404);
  const form = new FormData();
  for (const name of ["a.png", "b.png", "c.png"]) form.append("files", pngFile(name));
  const uploaded = await app.request("/api/personas/c_official/refs", { method: "POST", headers: { cookie }, body: form });
  expect(uploaded.status).toBe(404);
});

test("uploading refs below the minimum is rejected", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona({ ...fixture("c_mine", ownerId), refs: [] });
  const app = buildApp();

  const form = new FormData();
  form.append("files", pngFile("a.png"));
  form.append("files", pngFile("b.png"));
  const res = await app.request("/api/personas/c_mine/refs", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok: boolean; error: string };
  expect(body.error).toBe("invalid_ref_count");
});

test("uploading refs above the maximum is rejected and nothing is written", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona({ ...fixture("c_mine", ownerId), refs: [] });
  const app = buildApp();

  const form = new FormData();
  for (let i = 0; i < 8; i++) form.append("files", pngFile(`${i}.png`));
  const res = await app.request("/api/personas/c_mine/refs", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(res.status).toBe(400);

  const persona = await getPersona("c_mine");
  expect(persona?.refs).toEqual([]);
});

test("uploading 3-7 refs saves the files and appends to Persona.refs", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona({ ...fixture("c_mine", ownerId), refs: [] });
  const app = buildApp();

  const form = new FormData();
  form.append("files", pngFile("front.png"));
  form.append("files", pngFile("side.png"));
  form.append("files", pngFile("full.png"));
  const res = await app.request("/api/personas/c_mine/refs", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; persona: Persona };
  expect(body.persona.refs.length).toBe(3);
  expect(body.persona.version).toBe(2);

  for (const rel of body.persona.refs) {
    const file = Bun.file(join(process.env.KELVOY_PROJECTS_ROOT!, rel));
    expect(await file.exists()).toBe(true);
  }
});

test("rejects non-image files", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona({ ...fixture("c_mine", ownerId), refs: [] });
  const app = buildApp();

  const form = new FormData();
  form.append("files", pngFile("front.png"));
  form.append("files", pngFile("side.png"));
  form.append("files", new File([new Uint8Array([1])], "evil.exe", { type: "application/x-msdownload" }));
  const res = await app.request("/api/personas/c_mine/refs", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok: boolean; error: string };
  expect(body.error).toBe("invalid_file_type");
});
