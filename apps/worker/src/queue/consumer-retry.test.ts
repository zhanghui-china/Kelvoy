import type { H3PromptWriter } from "@kelvoy/engine";
import { beforeEach, afterEach, expect, test } from "bun:test";
import type { Destination, Episode, Persona, Shot } from "@kelvoy/engine";
import { close, open, getDb, insertEpisode, insertPersona, upsertDestination,
  enqueueTask, dequeueTask, grantCredits, getEpisode, submitFailedTaskRetry } from "@kelvoy/store";
import { handleTask } from "./consumer";

beforeEach(() => open(":memory:"));
afterEach(() => close());

const mockH3PromptWriter: H3PromptWriter = { async write({ context }) { return {
  prompt: "mock official H3 rewritten prompt", provenance: { skill_version: "test", writer_version: "test", model: "test",
    input_hash: "a".repeat(64), ref_hashes: context.references.map(() => "b".repeat(64)), mode: context.mode, duration_s: context.duration_s },
}; } };

function fixtureEpisode(id: string): Episode {
  return {
    name: "测试期", episode_id: id,
    owner_id: "u_test",
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
    brief: {
      season: "秋",
      aspect: "9:16",
      requirements: "",
      duration_s: 30,
      tone: "松弛",
      outfit_override: null,
      banned: [],
    },
    grid_refs: [],
    scenes: [],
    shots: [],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
  };
}

function destinationFixture(id: string): Destination {
  return {
    destination_id: id,
    version: 1,
    name: "测试景区",
    city: "测试市",
    type: "scenic_area",
    season_best: [],
    landmarks: [],
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

function personaFixture(id: string): Persona {
  return {
    persona_id: id,
    owner_id: "u_test",
    version: 1,
    name: "测试角色",
    desc: "",
    locked: [],
    default_outfit: "",
    refs: [],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

function shotFixture(): Shot {
  return {
    no: 1, scene: "s1", size: "medium", beat: "经过地标", camera: "push",
    landmark: "l1", kf_prompt: "角色在地标前", motion_prompt: "角色转身",
    duration_s: 1.5, candidates: [], kf_selected: null, clip: null,
    trim_start_s: null, status: "draft", regen_stage: null,
    bad_shot_reported: false, model: {},
  };
}


test.each([
  ["kf_review", "keyframe", "kf_ready", 2],
  ["clip_review", "video", "clip_ready", 10],
] as const)("%s failed-shot retry runs only the target and retains approved media", async (status, stage, readyStatus, price) => {
  const ep = { ...fixtureEpisode("e_review_retry"), status, final: { version: 1, key: "final/old.mp4", duration_s: 16, width: 1080, height: 1920, fps: 30, size_bytes: 100, completed_at: "2026-10-08T00:00:00Z" },
    shots: Array.from({ length: 8 }, (_, i) => ({ ...shotFixture(), no: i + 1,
      status: i === 0 ? "failed" as const : "approved" as const,
      candidates: [`kf/${i + 1}.png`], kf_selected: `kf/${i + 1}.png`, clip: `clip/${i + 1}.mp4`,
    })) };
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{
    id: "l1", name: "地标", refs: ["d/a.jpg"], best_time: "上午",
  }] });
  getDb().query("insert into users (user_id, username, password_hash) values ('u_test', 'retry-review', 'hash')").run();
  await enqueueTask({ episode_id: ep.episode_id, stage, shot_no: 1 });
  getDb().query("update tasks set status = 'failed' where episode_id = ?").run(ep.episode_id);
  grantCredits(ep.owner_id, price, "review-retry-credit");
  expect(submitFailedTaskRetry({ episode_id: ep.episode_id, owner_id: ep.owner_id, row_version: 1 }).ok).toBe(true);
  const queued = await getEpisode(ep.episode_id);
  if (!queued.ok) throw new Error("missing queued episode");
  const calls: number[] = [];
  await handleTask((await dequeueTask())!, {
    keyframe: { async generate(input) {
      calls.push(input.shot_no);
      return { key: `kf/retried_${input.candidate_no}.png`, model: "test", version: "1",
        seed: input.seed, seconds: 1, ref_hashes: [] };
    } },
    h3PromptWriter: mockH3PromptWriter,
    video: { async generate(input) {
      calls.push(input.shot_no);
      return { key: "clip/retried.mp4", model: "test", version: "1",
        seed: input.seed, seconds: 1, ref_hashes: [] };
    } },
  });
  expect(calls).toEqual(stage === "keyframe" ? [1, 1] : [1]);
  const ready = await getEpisode(ep.episode_id);
  if (!ready.ok) throw new Error("missing generated episode");
  expect(ready.episode.status).toBe(status);
  expect(ready.episode.shots[0]?.status).toBe(readyStatus);
  expect(ready.episode.shots.slice(1)).toEqual(queued.episode.shots.slice(1));
  expect(ready.episode.final).toEqual(ep.final);
  expect(ready.episode.credits_used).toBe(price);
  expect(await dequeueTask()).toBeNull();
});

test.each(["generation_timeout", "backend_unavailable"])("video %s records diagnostics with correct retry policy", async code => {
  const { GenerationError } = await import("../generation/errors");
  const ep: Episode = { ...fixtureEpisode("e_video_failure"), status: "clip_review", video_source: "references",
    shots: [{ ...shotFixture(), status: "draft", shot_id: "sh_target" }] };
  await insertEpisode(ep);
  await insertPersona({ ...personaFixture("c_test"), refs: ["p/front.png"] });
  await upsertDestination({ ...destinationFixture("d_test"), landmarks: [{ id: "l1", name: "地标", refs: ["d/a.jpg"], best_time: "上午" }] });
  const task = await enqueueTask({ episode_id: ep.episode_id, stage: "video", shot_no: 1, shot_id: "sh_target" });
  const diagnostic = { stage: "comfyui_wait", code, message: "安全错误提示。", elapsed_seconds: 900, budget_seconds: 900, cancellation: "confirmed" as const };
  await handleTask((await dequeueTask())!, {
    h3PromptWriter: mockH3PromptWriter,
    video: { async generate() { throw new GenerationError(diagnostic, code === "backend_unavailable"); } },
  });
  const row = getDb().query<{ status: string; error: string; attempt: number }, [string]>("select status,error,attempt from tasks where task_id = ?").get(task.task_id)!;
  expect(row.status).toBe(code === "generation_timeout" ? "failed" : "pending");
  expect(JSON.parse(row.error)).toMatchObject(diagnostic);
  expect(row.attempt).toBe(code === "generation_timeout" ? 1 : 2);
});
