import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, insertEpisode, open } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode, Shot, ShotModelRecord } from "@kelvoy/engine";
import { Hono } from "hono";
import share from "./share";

function fixture(id: string, shareEnabled: boolean, slug: string): Episode {
  return {
    name: "测试期", episode_id: id,
    owner_id: "u_owner",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "done",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 42,
    credits_used: 42,
    share: { enabled: shareEnabled, slug },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "松弛", outfit_override: null, banned: [] },
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
  expect(body.episode.title).toBe("无锡三日");
  expect(body.episode.owner_id).toBeUndefined();
  expect(body.episode.credits_used).toBeUndefined();
  expect(body.episode.brief).toBeUndefined();
  expect(body.episode.template_id).toBeUndefined();
});

const SENTINELS = [
  "SENTINEL_KF_PROMPT", "SENTINEL_MOTION_PROMPT", "SENTINEL_VIDEO_PROMPT",
  "SENTINEL_H3_MODEL", "SENTINEL_IMAGE_PROMPT", "SENTINEL_CANDIDATE",
  "SENTINEL_KF_SELECTED", "SENTINEL_CLIP", "SENTINEL_MUSIC_FILE", "SENTINEL_FINAL_KEY",
];

function leakyShot(no: number, tag: string): Shot {
  const record = (prompt: string): ShotModelRecord => ({
    provider: "mock" as ShotModelRecord["provider"], model: "m", version: "1", seed: 1,
    prompt, ref_hashes: [], attempts: 1, cost_usd: 0,
  });
  return {
    no, shot_id: `sh_${tag}_${no}`, scene: "s1", size: "wide", beat: "漫步",
    camera: "static", landmark: null,
    kf_prompt: `SENTINEL_KF_PROMPT_${tag}`, motion_prompt: `SENTINEL_MOTION_PROMPT_${tag}`,
    duration_s: 1, candidates: [`SENTINEL_CANDIDATE_${tag}.png`],
    kf_selected: `SENTINEL_KF_SELECTED_${tag}.png`, clip: `SENTINEL_CLIP_${tag}.mp4`,
    trim_start_s: 0, status: "approved", regen_stage: null, bad_shot_reported: false,
    model: {
      image: record(`SENTINEL_IMAGE_PROMPT_${tag}`),
      video: {
        ...record(`SENTINEL_VIDEO_PROMPT_${tag}`),
        h3_prompt: {
          skill_version: "v", writer_version: "v", model: `SENTINEL_H3_MODEL_${tag}`,
          input_hash: "a".repeat(64), ref_hashes: [], mode: "I2VA", duration_s: 4,
        },
      },
    },
  };
}

function leakyFinal(): NonNullable<Episode["final"]> {
  return { version: 1, key: "final/SENTINEL_FINAL_KEY.mp4", duration_s: 12.5,
    width: 1080, height: 1920, fps: 30, size_bytes: 9, completed_at: "2026-09-26T00:00:00Z" };
}

function expectNoLeak(text: string) {
  for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
}

test("shared episode is an explicit whitelist: no prompts, asset paths, or music/final keys", async () => {
  const episode = fixture("e_1", true, "abc123");
  episode.shots = [1, 2, 3].map((no) => leakyShot(no, "cur"));
  episode.music = { file: "music/SENTINEL_MUSIC_FILE.mp3", bpm: 120, license: "cc0" };
  episode.final = leakyFinal();
  await insertEpisode(episode);

  const res = await buildApp().request("/api/share/abc123");
  expect(res.status).toBe(200);
  const text = await res.text();
  expectNoLeak(text);
  const body = JSON.parse(text) as { episode: Record<string, unknown> };
  expect(Object.keys(body.episode).sort()).toEqual(
    ["episode_id", "final", "shot_count", "status", "title"]);
  expect(body.episode.shot_count).toBe(3);
  expect(body.episode.final).toEqual({ duration_s: 12.5, width: 1080, height: 1920 });
});

test("shared episode counts the delivered storyboard and hides its prompts too", async () => {
  const episode = fixture("e_1", true, "abc123");
  episode.shots = [1, 2, 3].map((no) => leakyShot(no, "cur"));
  episode.shared_storyboard = {
    scenes: episode.scenes,
    shots: [1, 2].map((no) => leakyShot(no, "shared")),
  };
  episode.final = leakyFinal();
  await insertEpisode(episode);

  const res = await buildApp().request("/api/share/abc123");
  const text = await res.text();
  expectNoLeak(text);
  const body = JSON.parse(text) as { episode: { shot_count: number } };
  expect(body.episode.shot_count).toBe(2);
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

test("share serves the recorded delivery version instead of an older file", async () => {
  const episode = fixture("e_1", true, "abc123");
  episode.final = { version: 2, key: "final/e_1_v2.mp4", duration_s: 30,
    width: 1080, height: 1920, fps: 30, size_bytes: 9,
    completed_at: "2026-09-26T00:00:00Z" };
  await insertEpisode(episode);
  await mkdir(join(tmpRoot, "projects", "e_1", "final"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_1", "final", "e_1_v1.mp4"), "old");
  await writeFile(join(tmpRoot, "projects", "e_1", "final", "e_1_v2.mp4"), "new");
  const res = await buildApp().request("/api/share/abc123/final.mp4");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("new");
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
