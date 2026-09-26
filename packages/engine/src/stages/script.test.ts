import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination } from "../schema/destination";
import type { Episode } from "../schema/episode";
import { ContentBlockedError } from "../rules/content";
import { runScript } from "./script";

const destination: Destination = {
  destination_id: "d_test",
  version: 1,
  name: "测试景区",
  city: "测试市",
  type: "scenic_area",
  season_best: ["秋"],
  landmarks: [{ id: "lm_1", name: "地标一", refs: [], best_time: "上午" }],
  route: ["山门", "地标一"],
  food: ["素斋"],
  transport: "地铁",
  stay: "民宿",
};

function fixtureEpisode(): Episode {
  return {
    name: "测试期", episode_id: "e_test",
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: "scripting",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-24T00:00:00+08:00",
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

const SIZES = ["wide", "medium", "close", "detail", "pov"] as const;

function validRawShots() {
  return Array.from({ length: 26 }, (_, i) => ({
    scene: "唯一段落",
    time: "morning",
    size: SIZES[i % SIZES.length],
    beat: `动作 ${i + 1}`,
    camera: "static",
    landmark: i % 5 === 0 ? "lm_1" : null,
    kf_prompt: `画面 ${i + 1}`,
    motion_prompt: `运动 ${i + 1}`,
  }));
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.STEPFUN_API_KEY;

beforeEach(() => {
  process.env.STEPFUN_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validRawShots()) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.STEPFUN_API_KEY;
  else process.env.STEPFUN_API_KEY = originalKey;
});

test("throws when called without a destination in context", async () => {
  await expect(runScript(fixtureEpisode())).rejects.toThrow("destination");
});

test("advances scripting -> script_review and fills shots/scenes", async () => {
  const updated = await runScript(fixtureEpisode(), undefined, { destination });

  expect(updated.status).toBe("script_review");
  expect(updated.shots).toHaveLength(26);
  expect(updated.scenes).toHaveLength(1);
});

test("throws ContentBlockedError before calling the provider when brief.banned hits the blocklist", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("不应该走到这里");
  }) as unknown as typeof fetch;

  const episode = { ...fixtureEpisode(), brief: { ...fixtureEpisode().brief, banned: ["色情"] } };
  await expect(runScript(episode, undefined, { destination })).rejects.toBeInstanceOf(ContentBlockedError);
  expect(fetchCalled).toBe(false);
});

test("throws (via state machine) when the episode isn't in scripting", async () => {
  const episode = { ...fixtureEpisode(), status: "done" as const };
  await expect(runScript(episode, undefined, { destination })).rejects.toThrow();
});
