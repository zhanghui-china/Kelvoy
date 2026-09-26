import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, createSession, createUser, open } from "@kelvoy/store";
import { afterEach, beforeEach } from "bun:test";
import type { Destination, Episode, Persona, Shot, ShotSize, Template } from "@kelvoy/engine";
import { Hono } from "hono";
import episodes from "./episodes";

export function fixture(id: string, ownerId: string): Episode {
  return {
    name: "测试期", episode_id: id,
    owner_id: ownerId,
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "draft",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "松弛", outfit_override: null, banned: [] },
    grid_refs: [],
    scenes: [],
    shots: [],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

export function shotFixture(no: number, overrides: Partial<Shot> = {}): Shot {
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
export function compliantShots(count: number, landmarkCount = 5): Shot[] {
  return Array.from({ length: count }, (_, i) =>
    shotFixture(i + 1, {
      size: SHOT_SIZES[i % SHOT_SIZES.length],
      landmark: i < landmarkCount ? "l1" : null,
    }),
  );
}

export function personaFixture(id: string, ownerId: string): Persona {
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

export function destinationFixture(id: string): Destination {
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

export function templateFixture(id: string): Template {
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

export function buildApp() {
  const app = new Hono();
  app.route("/api/episodes", episodes);
  return app;
}

export async function login(username: string): Promise<{ cookie: string; ownerId: string }> {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("unexpected username collision in test");
  const session = await createSession(created.user.user_id);
  return { cookie: `kelvoy_session=${session.session_id}`, ownerId: created.user.user_id };
}

export let tmpRoot: string;

export function setupEpisodeRouteTests(): void {
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

}
