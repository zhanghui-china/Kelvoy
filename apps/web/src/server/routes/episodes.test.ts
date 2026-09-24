import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  close,
  createSession,
  createUser,
  dequeueTask,
  insertEpisode,
  insertPersona,
  open,
  updatePersona,
  upsertDestination,
  upsertTemplate,
} from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination, Episode, Persona, Shot, ShotSize, Template } from "@kelvoy/engine";
import { estimateCost } from "@kelvoy/engine";
import { Hono } from "hono";
import episodes, { resolveArtifactPath } from "./episodes";

function fixture(id: string, ownerId: string): Episode {
  return {
    episode_id: id,
    owner_id: ownerId,
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot",
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", duration_s: 30, tone: "松弛", outfit_override: null, banned: [] },
    grid_refs: [],
    scenes: [],
    shots: [],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

function shotFixture(no: number, overrides: Partial<Shot> = {}): Shot {
  return {
    no,
    scene: "sc1",
    size: "wide",
    beat: "走过石板路",
    camera: "static",
    landmark: null,
    kf_prompt: "",
    motion_prompt: "",
    duration_s: 2,
    candidates: [],
    kf_selected: null,
    clip: null,
    trim_start_s: null,
    status: "draft",
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
    ...overrides,
  };
}

const SHOT_SIZES: ShotSize[] = ["wide", "medium", "close"];

// FR-02 结构规则 (MIN_SHOTS=24, MAX_SAME_SIZE_RUN=2, MIN_LANDMARK_SHOTS=5)
// compliant fixture — cycling sizes avoids same-size runs, first
// `landmarkCount` shots reference destinationFixture()'s one landmark ("l1").
function compliantShots(count: number, landmarkCount = 5): Shot[] {
  return Array.from({ length: count }, (_, i) =>
    shotFixture(i + 1, {
      size: SHOT_SIZES[i % SHOT_SIZES.length],
      landmark: i < landmarkCount ? "l1" : null,
    }),
  );
}

function personaFixture(id: string, ownerId: string): Persona {
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

function destinationFixture(id: string): Destination {
  return {
    destination_id: id,
    version: 1,
    name: "灵山大佛",
    city: "无锡",
    type: "scenic_area",
    season_best: ["秋"],
    landmarks: [{ id: "l1", name: "地标", refs: ["a.jpg", "b.jpg", "c.jpg"], best_time: "上午" }],
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

function templateFixture(id: string): Template {
  return {
    template_id: id,
    owner_id: null,
    name: "大型景区 · 一日",
    skeleton: "scenic_area",
    lut: "lut/warm_film.cube",
    intro: "intro/default.mp4",
    outro: null,
    title_style: "serif-center",
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/episodes", episodes);
  return app;
}

async function login(username: string): Promise<{ cookie: string; ownerId: string }> {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("unexpected username collision in test");
  const session = await createSession(created.user.user_id);
  return { cookie: `kelvoy_session=${session.session_id}`, ownerId: created.user.user_id };
}

let tmpRoot: string;

beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-episodes-api-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
});

afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

test("requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/episodes");
  expect(res.status).toBe(401);
});

test("lists only the logged-in user's own episodes", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_mine", ownerId));
  await insertEpisode(fixture("e_someone_elses", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { episodes: Episode[] };
  expect(body.episodes.map((e) => e.episode_id)).toEqual(["e_mine"]);
});

test("gets one episode by id with its row_version, for owner", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { episode: Episode; row_version: number };
  expect(body.episode.episode_id).toBe("e_1");
  expect(body.row_version).toBe(1);
});

test("404s on someone else's episode instead of leaking that it exists", async () => {
  const { cookie } = await login("dannei");
  await insertEpisode(fixture("e_1", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("404s on a nonexistent episode id", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/episodes/e_missing", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("serves an artifact file under the episode's directory", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));
  await mkdir(join(tmpRoot, "projects", "e_1", "kf"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_1", "kf", "01_a.png"), "fake-png-bytes");

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/files/kf/01_a.png", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("fake-png-bytes");
});

test("404s a missing file under a real episode", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/files/kf/nope.png", { headers: { cookie } });
  expect(res.status).toBe(404);
});

// A literal ".." never survives to reach the route handler over real HTTP
// (Bun.serve/WHATWG URL normalization collapses dot-segments before Hono
// routes the request — verified separately), so path-traversal payloads
// are exercised directly against resolveArtifactPath() instead of via
// app.request(), which would just have the URL layer neutralize them
// before this code ever ran.
test("resolveArtifactPath rejects .. that climbs above the episode root", () => {
  expect(resolveArtifactPath("e_1", "../../secret.txt")).toBeNull();
  expect(resolveArtifactPath("e_1", "kf/../../../../etc/passwd")).toBeNull();
});

test("resolveArtifactPath folds a leading-slash payload under the root instead of escaping to it", () => {
  const result = resolveArtifactPath("e_1", "/etc/passwd");
  expect(result).toBe(join(tmpRoot, "projects", "e_1", "etc", "passwd"));
});

test("resolveArtifactPath rejects an empty key", () => {
  expect(resolveArtifactPath("e_1", "")).toBeNull();
});

test("resolveArtifactPath accepts a normal nested key", () => {
  const result = resolveArtifactPath("e_1", "kf/01_a.png");
  expect(result).toBe(join(tmpRoot, "projects", "e_1", "kf", "01_a.png"));
});

test("POST creates a draft episode, snapshots versions, prefills render from the template, and enqueues a brief task", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; episode: Episode };
  const episode = body.episode;

  expect(episode.status).toBe("draft");
  expect(episode.owner_id).toBe(ownerId);
  expect(episode.persona_version).toBe(1);
  expect(episode.destination_version).toBe(1);
  expect(episode.mode).toBe("per_shot"); // FR-01: 默认逐镜
  // FR-01/FR-09 粗估：建期这一刻没有真实镜数，estimateCost 用它的默认常量。
  expect(episode.estimated_credits).toBe(estimateCost({ mode: "per_shot" }).estimated_credits);
  expect(episode.estimated_credits).toBeGreaterThan(0);
  expect(episode.render.intro).toBe("intro/default.mp4");
  expect(episode.render.outro).toBeNull();
  expect(episode.brief.season).toBe("秋"); // 缺省取 destination.season_best[0]
  expect(episode.brief.outfit_override).toBeNull(); // FR-01: 缺省不覆盖角色默认穿搭

  const task = await dequeueTask();
  expect(task?.episode_id).toBe(episode.episode_id);
  expect(task?.stage).toBe("brief");
});

test("POST honors an explicit season/tone/banned/mode over the defaults", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      persona_id: "c_1",
      destination_id: "d_1",
      template_id: "t_1",
      season: "春",
      tone: "松弛",
      banned: ["真人"],
      mode: "grid",
      outfit_override: "冲锋衣",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { episode: Episode };
  expect(body.episode.brief).toEqual({
    season: "春",
    aspect: "9:16",
    duration_s: 30,
    tone: "松弛",
    outfit_override: "冲锋衣",
    banned: ["真人"],
  });
  expect(body.episode.mode).toBe("grid");
  // grid 模式关键帧成本打五折，估价应该比默认 per_shot 低。
  expect(body.episode.estimated_credits).toBe(estimateCost({ mode: "grid" }).estimated_credits);
});

test("GET /estimate returns a cost estimate for a given mode without touching the db", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();

  const perShotRes = await app.request("/api/episodes/estimate?mode=per_shot", { headers: { cookie } });
  expect(perShotRes.status).toBe(200);
  const perShotBody = (await perShotRes.json()) as { ok: boolean; estimate: unknown };
  expect(perShotBody.estimate).toEqual(estimateCost({ mode: "per_shot" }));

  const gridRes = await app.request("/api/episodes/estimate?mode=grid", { headers: { cookie } });
  const gridBody = (await gridRes.json()) as { estimate: { gpu_minutes: number } };
  expect(gridBody.estimate.gpu_minutes).toBeLessThan(
    (perShotBody.estimate as { gpu_minutes: number }).gpu_minutes,
  );
});

test("GET /estimate rejects a missing or invalid mode", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();

  const missing = await app.request("/api/episodes/estimate", { headers: { cookie } });
  expect(missing.status).toBe(400);

  const invalid = await app.request("/api/episodes/estimate?mode=widescreen", { headers: { cookie } });
  expect(invalid.status).toBe(400);
});

test("GET /estimate requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/episodes/estimate?mode=per_shot");
  expect(res.status).toBe(401);
});

test("POST snapshots the persona version at submit time, not the latest one", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  const body = (await res.json()) as { episode: Episode };
  expect(body.episode.persona_version).toBe(1);

  await updatePersona("c_1", { desc: "改过的描述" }); // bumps to version 2

  const stored = (await (await app.request(`/api/episodes/${body.episode.episode_id}`, { headers: { cookie } })).json()) as {
    episode: Episode;
  };
  expect(stored.episode.persona_version).toBe(1); // 不受之后的角色改动影响
});

test("POST 404s when persona_id doesn't belong to the caller", async () => {
  const { cookie } = await login("dannei");
  await insertPersona(personaFixture("c_1", "u_someone_else"));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(404);
});

test("POST 400s on a missing required field", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(400);
});

// ---- M1-14: 内容审核关键词拦截 (#29) ----

test("POST 400s with content_blocked when tone hits the keyword blocklist", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      persona_id: "c_1",
      destination_id: "d_1",
      template_id: "t_1",
      tone: "色情",
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  expect(body.error).toBe("content_blocked");
});

// ---- M2-6: 审片台写路由 ----

test("PATCH /:id applies a field patch and bumps row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { credits_used: 3 } }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, row_version: 2 });

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.credits_used).toBe(3);
});

test("PATCH /:id 409s on a stale row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 999, patch: { credits_used: 3 } }),
  });
  expect(res.status).toBe(409);
});

test("PATCH /:id 400s on an illegal status transition", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId)); // status: draft

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { status: "done" } }), // draft -> done: no such edge
  });
  expect(res.status).toBe(400);
});

test("PATCH /:id 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  await insertEpisode(fixture("e_1", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { credits_used: 3 } }),
  });
  expect(res.status).toBe(404);
});

test("PATCH /:id/shots/:no applies a shot patch and bumps the episode's row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { candidates: ["kf/01_a.png"] } }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.shots[0]?.candidates).toEqual(["kf/01_a.png"]);
});

test("PATCH /:id/shots/:no 404s on a shot number that doesn't exist", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/99", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { candidates: ["x.png"] } }),
  });
  expect(res.status).toBe(404);
});

test("POST /:id/save-as-template requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "我的模板" }),
  });
  expect(res.status).toBe(401);
});

test("POST /:id/save-as-template derives a private template from the episode's skeleton/style/render", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  await insertPersona(personaFixture("c_1", ownerId));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.persona_id = "c_1";
  episode.render.intro = "intro/custom.mp4";
  episode.render.outro = "outro/custom.mp4";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "我的模板" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; template: Template };
  expect(body.template.owner_id).toBe(ownerId);
  expect(body.template.name).toBe("我的模板");
  expect(body.template.skeleton).toBe("scenic_area");
  expect(body.template.lut).toBe("lut/warm_film.cube");
  expect(body.template.title_style).toBe("serif-center");
  expect(body.template.intro).toBe("intro/custom.mp4");
  expect(body.template.outro).toBe("outro/custom.mp4");
});

test("POST /:id/save-as-template 400s on a missing name", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  await insertPersona(personaFixture("c_1", ownerId));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.persona_id = "c_1";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

test("POST /:id/save-as-template 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  await insertPersona(personaFixture("c_1", "u_someone_else"));
  const episode = fixture("e_1", "u_someone_else");
  episode.destination_id = "d_1";
  episode.persona_id = "c_1";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/save-as-template", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "我的模板" }),
  });
  expect(res.status).toBe(404);
});

test("POST /:id/continue advances script_review -> assets and enqueues one whole-episode task", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "script_review";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.status).toBe("assets");

  const task = await dequeueTask();
  expect(task?.stage).toBe("assets");
  expect(task?.shot_no).toBeUndefined();
});

test("POST /:id/continue advances kf_review -> clipping and enqueues one video task per kf_selected shot", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "kf_review";
  episode.shots = [
    shotFixture(1, { status: "kf_selected" }),
    shotFixture(2, { status: "kf_selected" }),
    shotFixture(3, { status: "kf_ready" }), // not yet selected — must not get a task
  ];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.status).toBe("clipping");

  const shotNos = new Set<number | undefined>();
  for (let i = 0; i < 2; i++) {
    const task = await dequeueTask();
    expect(task?.stage).toBe("video");
    shotNos.add(task?.shot_no);
  }
  expect(shotNos).toEqual(new Set([1, 2]));
  expect(await dequeueTask()).toBeNull(); // shot 3 (kf_ready) got no task
});

test("POST /:id/continue 400s outside a review gate", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId)); // status: draft, not a review gate

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/continue", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});

test("POST /:id/shots/:no/regen rejects the shot, infers regen_stage from status, and enqueues", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1, { status: "kf_ready" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shot = ((await got.json()) as { episode: Episode }).episode.shots[0];
  expect(shot?.status).toBe("rejected");
  expect(shot?.regen_stage).toBe("keyframe"); // kf_ready -> still picking a keyframe

  const task = await dequeueTask();
  expect(task?.stage).toBe("keyframe");
  expect(task?.shot_no).toBe(1);
});

test("POST /:id/shots/:no/regen honors an explicit regen_stage override", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1, { status: "approved" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, regen_stage: "keyframe" }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shot = ((await got.json()) as { episode: Episode }).episode.shots[0];
  expect(shot?.regen_stage).toBe("keyframe");
});

test("POST /:id/shots/:no/regen 400s from a status that isn't a regen source", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1, { status: "draft" })]; // draft can't go straight to rejected
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/regen", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});

test("POST /:id/shots/:no/report-bad marks bad_shot_reported, rejects, and enqueues a free regen", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1, { status: "approved" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1/report-bad", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shot = ((await got.json()) as { episode: Episode }).episode.shots[0];
  expect(shot?.bad_shot_reported).toBe(true);
  expect(shot?.status).toBe("rejected");
  expect(shot?.regen_stage).toBe("video"); // approved -> clip already made, redo the clip

  const task = await dequeueTask();
  expect(task?.stage).toBe("video");
  expect(task?.shot_no).toBe(1);
});

test("POST /:id/shots/:no/remove deletes the shot and re-validates FR-02 on what's left", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = compliantShots(25, 6); // extra shot + extra landmark headroom
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/25/remove", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const body = (await got.json()) as { episode: Episode };
  expect(body.episode.shots).toHaveLength(24);
  expect(body.episode.shots.some((s) => s.no === 25)).toBe(false);
  expect(body.episode.removed_shots.map((s) => s.no)).toEqual([25]);
});

test("POST /:id/shots/:no/remove 400s when it would drop below the MIN_SHOTS floor", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = compliantShots(24, 6); // exactly at the floor
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/24/remove", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots).toHaveLength(24); // untouched
});

test("POST /:id/shots/:no/remove 400s when the remainder fails FR-02 (landmark coverage)", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = compliantShots(25, 5); // exactly at the MIN_LANDMARK_SHOTS floor
  await insertEpisode(episode);

  const app = buildApp();
  // shot 1 is one of the 5 landmark shots — removing it drops coverage to 4
  const res = await app.request("/api/episodes/e_1/shots/1/remove", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
  const errBody = (await res.json()) as { error: string };
  expect(errBody.error).toBe("script_rule_violation");

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots).toHaveLength(25); // untouched
});

test("POST /:id/recompose moves done -> composing and enqueues a compose task", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "done";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/recompose", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.status).toBe("composing");

  const task = await dequeueTask();
  expect(task?.stage).toBe("compose");
});

test("POST /:id/recompose 400s from any status other than done", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.status = "clip_review"; // also a legal advance -> composing, but not via this endpoint
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/recompose", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1 }),
  });
  expect(res.status).toBe(400);
});

// ---- M2-9 (#31): 审片台交互页要的写路由 ----

test("PATCH /:id/shots/:no applies the review-1/2 editable fields", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      row_version: 1,
      patch: {
        beat: "抬头看大佛",
        size: "close",
        camera: "push",
        landmark: "l1",
        kf_prompt: "仰角特写",
        motion_prompt: "缓慢上摇",
      },
    }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shot = ((await got.json()) as { episode: Episode }).episode.shots[0];
  expect(shot?.beat).toBe("抬头看大佛");
  expect(shot?.size).toBe("close");
  expect(shot?.camera).toBe("push");
  expect(shot?.landmark).toBe("l1");
  expect(shot?.kf_prompt).toBe("仰角特写");
  expect(shot?.motion_prompt).toBe("缓慢上摇");
});

test("PATCH /:id/shots/:no 400s with content_blocked when an edited prompt hits the blocklist", async () => {
  const { cookie, ownerId } = await login("dannei");
  const episode = fixture("e_1", ownerId);
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { kf_prompt: "裸体 站在山顶" } }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; violations: { field: string; term: string }[] };
  expect(body.error).toBe("content_blocked");
  expect(body.violations[0]?.field).toBe("kf_prompt");

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots[0]?.kf_prompt).toBe(""); // untouched
});

test("PATCH /:id/shots/:no 400s on a landmark id the destination doesn't have", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = [shotFixture(1)];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { landmark: "l_nope" } }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("landmark_reference");
});

test("PATCH /:id/shots/:no accepts clearing the landmark to null", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.shots = [shotFixture(1, { landmark: "l1" })];
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, patch: { landmark: null } }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(((await got.json()) as { episode: Episode }).episode.shots[0]?.landmark).toBeNull();
});

test("POST /:id/shots/reorder reorders and renumbers the shots", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const order = episode.shots.map((s) => s.no).reverse();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order }),
  });
  expect(res.status).toBe(200);

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shots = ((await got.json()) as { episode: Episode }).episode.shots;
  expect(shots.map((s) => s.no)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  expect(shots[0]?.size).toBe(episode.shots[23].size); // last shot moved to the front
});

test("POST /:id/shots/reorder 400s when the new order breaks FR-02 (size run)", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6); // sizes cycle wide/medium/close
  await insertEpisode(episode);

  // 1/4/7 are all "wide" — putting them next to each other is a run of 3
  const rest = episode.shots.map((s) => s.no).filter((no) => ![1, 4, 7].includes(no));
  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: [1, 4, 7, ...rest] }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("script_rule_violation");

  const got = await app.request("/api/episodes/e_1", { headers: { cookie } });
  const shots = ((await got.json()) as { episode: Episode }).episode.shots;
  expect(shots.map((s) => s.no)).toEqual(episode.shots.map((s) => s.no)); // untouched
});

test("POST /:id/shots/reorder 400s on an order that isn't a permutation of the shots", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: [1, 2, 3] }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_order");
});

test("POST /:id/shots/reorder 400s outside review 1", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "kf_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: episode.shots.map((s) => s.no).reverse() }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_order");
});

test("POST /:id/shots/reorder 409s on a stale row_version", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertDestination(destinationFixture("d_1"));
  const episode = fixture("e_1", ownerId);
  episode.destination_id = "d_1";
  episode.status = "script_review";
  episode.shots = compliantShots(24, 6);
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 99, order: episode.shots.map((s) => s.no).reverse() }),
  });
  expect(res.status).toBe(409);
});

test("POST /:id/shots/reorder 404s on someone else's episode", async () => {
  const { cookie } = await login("dannei");
  const episode = fixture("e_1", "u_someone_else");
  episode.status = "script_review";
  await insertEpisode(episode);

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/shots/reorder", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ row_version: 1, order: [] }),
  });
  expect(res.status).toBe(404);
});
