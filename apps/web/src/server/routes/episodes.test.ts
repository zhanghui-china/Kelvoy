import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  close,
  createSession,
  createUser,
  insertEpisode,
  open,
} from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
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
