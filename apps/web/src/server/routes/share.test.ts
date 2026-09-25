import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, insertEpisode, open } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { Hono } from "hono";
import share from "./share";

function fixture(id: string, shareEnabled: boolean, slug: string): Episode {
  return {
    episode_id: id,
    owner_id: "u_owner",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "done",
    mode: "per_shot",
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 42,
    credits_used: 42,
    share: { enabled: shareEnabled, slug },
    brief: { season: "秋", aspect: "9:16", duration_s: 30, tone: "松弛", outfit_override: null, banned: [] },
    grid_refs: [],
    scenes: [{ id: "s1", name: "到达", time: "morning", landmarks: [] }],
    shots: [],
    removed_shots: [],
    music: { file: "music/a.mp3", bpm: 120, license: "cc0" },
    render: { res: "1080x1920", fps: 30, title: "无锡三日", intro: null, outro: null, ai_label: true },
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/share", share);
  return app;
}

let tmpRoot: string;

beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-share-api-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
});

afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

test("returns the film + shot-table fields with no login required, and no account info", async () => {
  await insertEpisode(fixture("e_1", true, "abc123"));

  const app = buildApp();
  const res = await app.request("/api/share/abc123");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; episode: Record<string, unknown> };
  expect(body.episode.render).toEqual({
    res: "1080x1920",
    fps: 30,
    title: "无锡三日",
    intro: null,
    outro: null,
    ai_label: true,
  });
  expect(body.episode.owner_id).toBeUndefined();
  expect(body.episode.credits_used).toBeUndefined();
  expect(body.episode.brief).toBeUndefined();
  expect(body.episode.template_id).toBeUndefined();
});

test("404s when share.enabled is false", async () => {
  await insertEpisode(fixture("e_1", false, "abc123"));

  const app = buildApp();
  const res = await app.request("/api/share/abc123");
  expect(res.status).toBe(404);
});

test("404s an unknown slug", async () => {
  const app = buildApp();
  const res = await app.request("/api/share/no-such-slug");
  expect(res.status).toBe(404);
});

test("GET /:slug/final.mp4 serves the final video with no login required", async () => {
  await insertEpisode(fixture("e_1", true, "abc123"));
  await mkdir(join(tmpRoot, "projects", "e_1", "final"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_1", "final", "e_1.mp4"), "fake-mp4-bytes");

  const app = buildApp();
  const res = await app.request("/api/share/abc123/final.mp4");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("fake-mp4-bytes");
});

test("GET /:slug/final.mp4 404s when sharing is off, even if the file exists", async () => {
  await insertEpisode(fixture("e_1", false, "abc123"));
  await mkdir(join(tmpRoot, "projects", "e_1", "final"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_1", "final", "e_1.mp4"), "fake-mp4-bytes");

  const app = buildApp();
  const res = await app.request("/api/share/abc123/final.mp4");
  expect(res.status).toBe(404);
});

test("share temporarily hides an old film while a shot is being regenerated", async () => {
  const episode = fixture("e_1", true, "abc123");
  episode.status = "clip_review";
  await insertEpisode(episode);
  await mkdir(join(tmpRoot, "projects", "e_1", "final"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_1", "final", "e_1.mp4"), "old-film");

  const app = buildApp();
  expect((await app.request("/api/share/abc123")).status).toBe(404);
  expect((await app.request("/api/share/abc123/final.mp4")).status).toBe(404);
});

test("GET /:slug/final.mp4 404s when composing hasn't produced the file yet", async () => {
  await insertEpisode(fixture("e_1", true, "abc123"));

  const app = buildApp();
  const res = await app.request("/api/share/abc123/final.mp4");
  expect(res.status).toBe(404);
});
