import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  claimViewsJob, close, completeViewsJob, createSession, createUser, getCreditBalance, getPersona, grantCredits,
  insertPersona, open,
} from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Persona, ThreeViews, ViewsGeneration } from "@kelvoy/engine";
import { Hono } from "hono";
import assets from "./assets";
import outfits from "./persona-outfits";
import views from "./persona-views";

const persona = (id: string, ownerId: string | null): Persona => ({
  persona_id: id, owner_id: ownerId, version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["persona/front.png", "persona/side.png", "persona/full.png"], style: { lut: "x", title_style: "y" },
});
const app = () => {
  const a = new Hono();
  a.route("/api/personas", outfits);
  a.route("/api/personas", views);
  a.route("/api/assets", assets);
  return a;
};
const png = (n = "a.png") => new File([new Uint8Array([1, 2, 3])], n, { type: "image/png" });
const gen: ViewsGeneration = { provider: "local", model: "qwen-image-edit", version: "1", seed: 7 };
const viewsFor = (tag: string, personaId = "c_1"): ThreeViews => ({
  front: `persona/${personaId}/views/${tag}-f.jpg`, side: `persona/${personaId}/views/${tag}-s.jpg`,
  back: `persona/${personaId}/views/${tag}-b.jpg`, sheet: `persona/${personaId}/views/${tag}-sheet.jpg`,
});

async function login(username: string, credits = 20) {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("collision");
  if (credits > 0) grantCredits(created.user.user_id, credits, `g_${username}`);
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
let projects: string;
beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-views-api-"));
  projects = join(tmpRoot, "projects");
  process.env.KELVOY_PROJECTS_ROOT = projects;
});
afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

const send = (method: string, path: string, cookie: string, body?: unknown) => app().request(path, {
  method, headers: body === undefined ? { cookie } : { cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function createSourceOutfit(cookie: string, personaId: string, files = [png()]) {
  return app().request(`/api/personas/${personaId}/outfits/source`, { method: "POST", headers: { cookie },
    body: form({ name: "风衣", desc: "米色", seasons: ["秋"] }, files) });
}
async function createSource(cookie: string, personaId = "c_1"): Promise<string> {
  const res = await createSourceOutfit(cookie, personaId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { outfit: { outfit_id: string } }).outfit.outfit_id;
}
const outfitOf = async (personaId: string, outfitId: string) =>
  (await getPersona(personaId))?.outfits?.find((o) => o.outfit_id === outfitId);

/** Drives the job to succeeded the way the worker would, and writes the four files so assets can be read. */
async function finishJob(tag: string, personaId = "c_1"): Promise<ThreeViews> {
  const claimed = (await claimViewsJob())!;
  const v = viewsFor(tag, personaId);
  for (const key of Object.values(v)) {
    await mkdir(dirname(join(projects, key)), { recursive: true });
    await Bun.write(join(projects, key), new Uint8Array([9, 9]));
  }
  const done = await completeViewsJob({ job_id: claimed.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: v, views_gen: gen });
  expect(done.ok).toBe(true);
  return v;
}

test("a source-only outfit is created from one full-body photo with no refs", async () => {
  const { cookie, ownerId } = await login("v1");
  await insertPersona(persona("c_1", ownerId));
  const res = await createSourceOutfit(cookie, "c_1");
  expect(res.status).toBe(201);
  const body = await res.json() as { persona: Persona; outfit: { refs: string[]; source: string } };
  expect(body.outfit.refs).toEqual([]);
  expect(body.outfit.source).toMatch(/^persona\/c_1\//);
  expect(body.persona.version).toBe(2);
  expect((await createSourceOutfit(cookie, "c_1", [png(), png()])).status).toBe(400);
  expect((await createSourceOutfit(cookie, "c_1", [])).status).toBe(400);
});

test("generation creates a pending job, a repeat returns it without a second reservation", async () => {
  const { cookie, ownerId } = await login("v2");
  await insertPersona(persona("c_1", ownerId));
  const outfitId = await createSource(cookie);
  const created = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: outfitId });
  expect(created.status).toBe(201);
  const job = (await created.json() as { job: { job_id: string; status: string } }).job;
  expect(job.status).toBe("pending");
  expect((await outfitOf("c_1", outfitId))?.views_status).toBe("pending");
  const reserved = getCreditBalance(ownerId).reserved;
  expect(reserved).toBeGreaterThan(0);
  const repeat = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: outfitId });
  expect(repeat.status).toBe(200);
  expect(await repeat.json()).toMatchObject({ ok: true, repeated: true, job: { job_id: job.job_id } });
  expect(getCreditBalance(ownerId).reserved).toBe(reserved);
});

test("the default outfit (null or omitted outfit_id) uses refs[0] as its source", async () => {
  const { cookie, ownerId } = await login("v3");
  await insertPersona(persona("c_1", ownerId));
  expect((await send("POST", "/api/personas/c_1/views", cookie, {})).status).toBe(201);
  expect((await getPersona("c_1"))?.views_status).toBe("pending");
});

test("bad bodies are 400; unknown outfits 404; a legacy outfit without source is 409 no_source", async () => {
  const { cookie, ownerId } = await login("v4");
  await insertPersona(persona("c_1", ownerId));
  for (const body of [{ outfit_id: 5 }, { outfit_id: "" }, { outfit_id: "../x" }, { regenerate: "yes" }, [1]]) {
    expect((await send("POST", "/api/personas/c_1/views", cookie, body)).status).toBe(400);
  }
  const malformed = await app().request("/api/personas/c_1/views", { method: "POST",
    headers: { cookie, "content-type": "application/json" }, body: "{bad" });
  expect(malformed.status).toBe(400);
  const missing = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: "o_missing" });
  expect(missing.status).toBe(404);
  expect(((await missing.json()) as { error: string }).error).toBe("outfit_not_found");
  const legacy = await app().request("/api/personas/c_1/outfits", { method: "POST", headers: { cookie },
    body: form({ name: "旧式", desc: "", seasons: ["秋"] }, [png()]) });
  const legacyId = ((await legacy.json()) as { outfit: { outfit_id: string } }).outfit.outfit_id;
  const res = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: legacyId });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: string }).error).toBe("no_source");
});

test("without credits generation is 402 and the outfit is left untouched", async () => {
  const { cookie, ownerId } = await login("v5", 0);
  await insertPersona(persona("c_1", ownerId));
  const outfitId = await createSource(cookie);
  const res = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: outfitId });
  expect(res.status).toBe(402);
  expect((await outfitOf("c_1", outfitId))?.views_status).toBeUndefined();
});

test("a finished job makes the outfit ready; regenerate is explicit; cancel restores the prior views", async () => {
  const { cookie, ownerId } = await login("v6");
  await insertPersona(persona("c_1", ownerId));
  const outfitId = await createSource(cookie);
  const first = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: outfitId });
  const jobId = ((await first.json()) as { job: { job_id: string } }).job.job_id;
  const firstViews = await finishJob("v1");

  const got = await send("GET", `/api/personas/c_1/views/jobs/${jobId}`, cookie);
  expect(await got.json()).toMatchObject({ ok: true, job: { status: "succeeded" } });
  expect(await outfitOf("c_1", outfitId)).toMatchObject({ views_status: "ready", views: firstViews });
  expect((await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: outfitId })).status).toBe(409);

  const again = await send("POST", "/api/personas/c_1/views", cookie, { outfit_id: outfitId, regenerate: true });
  expect(again.status).toBe(201);
  const retryId = ((await again.json()) as { job: { job_id: string } }).job.job_id;
  expect((await outfitOf("c_1", outfitId))?.views_status).toBe("pending");

  const cancelled = await send("POST", `/api/personas/c_1/views/jobs/${retryId}/cancel`, cookie);
  expect(cancelled.status).toBe(200);
  expect(await cancelled.json()).toMatchObject({ ok: true, job: { status: "cancelled" }, repeated: false });
  expect(await outfitOf("c_1", outfitId)).toMatchObject({ views_status: "ready", views: firstViews });
  expect((await send("POST", `/api/personas/c_1/views/jobs/${retryId}/cancel`, cookie)).status).toBe(200);
  expect(getCreditBalance(ownerId).reserved).toBe(0);

  const listed = await send("GET", "/api/personas/c_1/views/jobs", cookie);
  const jobs = ((await listed.json()) as { jobs: { job_id: string }[] }).jobs;
  expect(jobs.map((j) => j.job_id)).toEqual([retryId, jobId]);
});

test("other accounts, official and missing personas, and cross-persona job ids all get 404", async () => {
  const owner = await login("v7");
  const other = await login("v8");
  await insertPersona(persona("c_1", owner.ownerId));
  await insertPersona(persona("c_2", owner.ownerId));
  await insertPersona(persona("c_official", null));
  const outfitId = await createSource(owner.cookie);
  const created = await send("POST", "/api/personas/c_1/views", owner.cookie, { outfit_id: outfitId });
  const jobId = ((await created.json()) as { job: { job_id: string } }).job.job_id;

  expect((await send("POST", "/api/personas/c_1/views", other.cookie, { outfit_id: outfitId })).status).toBe(404);
  expect((await send("GET", "/api/personas/c_1/views/jobs", other.cookie)).status).toBe(404);
  expect((await send("GET", `/api/personas/c_1/views/jobs/${jobId}`, other.cookie)).status).toBe(404);
  expect((await send("POST", `/api/personas/c_1/views/jobs/${jobId}/cancel`, other.cookie)).status).toBe(404);
  expect((await send("POST", "/api/personas/c_official/views", owner.cookie, {})).status).toBe(404);
  expect((await send("POST", "/api/personas/c_missing/views", owner.cookie, {})).status).toBe(404);
  expect((await send("GET", `/api/personas/c_2/views/jobs/${jobId}`, owner.cookie)).status).toBe(404);
  expect((await send("POST", `/api/personas/c_2/views/jobs/${jobId}/cancel`, owner.cookie)).status).toBe(404);
  expect((await send("GET", "/api/personas/c_1/views/jobs", owner.cookie)).status).toBe(200);
  expect(getCreditBalance(owner.ownerId).reserved).toBeGreaterThan(0);
});

test("the source and the four view images are readable by the owner only", async () => {
  const owner = await login("v9");
  const other = await login("v10");
  await insertPersona(persona("c_1", owner.ownerId));
  const created = await createSourceOutfit(owner.cookie, "c_1");
  const { outfit } = await created.json() as { outfit: { outfit_id: string; source: string } };
  await mkdir(dirname(join(projects, outfit.source)), { recursive: true });
  await Bun.write(join(projects, outfit.source), png());
  await send("POST", "/api/personas/c_1/views", owner.cookie, { outfit_id: outfit.outfit_id });
  const v = await finishJob("v1");

  const read = (key: string, cookie: string) => app().request(`/api/assets/${key}`, { headers: { cookie } });
  expect((await read(outfit.source, owner.cookie)).status).toBe(200);
  expect((await read(v.sheet, owner.cookie)).status).toBe(200);
  expect((await read(v.front, owner.cookie)).status).toBe(200);
  expect((await read(outfit.source, other.cookie)).status).toBe(404);
  expect((await read(v.sheet, other.cookie)).status).toBe(404);
  expect((await read("persona/c_1/views/nope.jpg", owner.cookie)).status).toBe(404);
});
