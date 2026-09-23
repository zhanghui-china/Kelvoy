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
import type { Destination, Episode, Persona, Template } from "@kelvoy/engine";
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
  expect(episode.estimated_credits).toBe(0);
  expect(episode.render.intro).toBe("intro/default.mp4");
  expect(episode.render.outro).toBeNull();
  expect(episode.brief.season).toBe("秋"); // 缺省取 destination.season_best[0]

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
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { episode: Episode };
  expect(body.episode.brief).toEqual({
    season: "春",
    aspect: "9:16",
    duration_s: 30,
    tone: "松弛",
    outfit_override: null,
    banned: ["真人"],
  });
  expect(body.episode.mode).toBe("grid");
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
