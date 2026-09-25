import { expect, test } from "bun:test";
import type { Destination, Episode, Persona, Shot } from "../schema";
import { runAssets } from "./assets";
import { runKeyframe } from "./keyframe";
import { runVideo } from "./video";
import type { StageContext } from "./types";

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    no: 1, scene: "s1", size: "medium", beat: "经过大佛", camera: "push",
    landmark: "l1", kf_prompt: "角色站在灵山大佛前", motion_prompt: "缓慢转身",
    duration_s: 1.5, candidates: [], kf_selected: null, clip: null,
    trim_start_s: null, status: "draft", regen_stage: null,
    bad_shot_reported: false, model: {}, ...overrides,
  };
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    episode_id: "e1", owner_id: "u1", persona_id: "p1", persona_version: 1,
    destination_id: "d1", destination_version: 1, series_id: "s1", template_id: "t1",
    status: "assets", mode: "per_shot", created_at: "2026-09-25T00:00:00Z",
    estimated_credits: 0, credits_used: 0, share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", duration_s: 30, tone: "", outfit_override: null, banned: [] },
    grid_refs: [], scenes: [], shots: [shot()], removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: { res: "1080x1920", fps: 30, title: "", intro: null, outro: null, ai_label: true },
    ...overrides,
  };
}

const persona: Persona = {
  persona_id: "p1", owner_id: "u1", version: 1, name: "角色", desc: "", locked: [],
  default_outfit: "", refs: ["persona/front.png", "persona/side.png", "persona/full.png"],
  style: { lut: "", title_style: "" },
};
const destination: Destination = {
  destination_id: "d1", version: 1, name: "灵山", city: "无锡", type: "scenic_area",
  season_best: [], landmarks: [{ id: "l1", name: "灵山大佛", refs: ["dest/a.jpg", "dest/b.jpg", "dest/c.jpg"], best_time: "上午" }],
  route: [], food: [], transport: "", stay: "",
};

test("assets checks real references before allowing keyframing", async () => {
  const next = await runAssets(episode(), undefined, { persona, destination });
  expect(next.status).toBe("keyframing");
  expect(next.shots[0]?.status).toBe("draft");
  await expect(runAssets(episode(), undefined, {
    persona, destination: { ...destination, landmarks: [{ ...destination.landmarks[0]!, refs: [] }] },
  })).rejects.toThrow("地标");
});

test("one shot produces two distinct candidates and enters keyframe review", async () => {
  const calls: unknown[] = [];
  const context: StageContext = {
    persona, destination, generation_id: "task-1", attempt: 1,
    keyframe: { async generate(input) {
      calls.push(input);
      return { key: `kf/01_${input.candidate_no}.png`, model: "Qwen-Image-2.1",
        version: "hash1", seed: input.seed, seconds: 40,
        ref_hashes: ["persona-hash", "landmark-hash"] };
    } },
  };
  const next = await runKeyframe(episode({ status: "keyframing", shots: [shot({ status: "generating_kf" })] }), 1, context);
  expect(next.status).toBe("kf_review");
  expect(next.shots[0]?.status).toBe("kf_ready");
  expect(next.shots[0]?.candidates).toEqual(["kf/01_0.png", "kf/01_1.png"]);
  expect(next.shots[0]?.model.image?.ref_hashes).toEqual(["persona-hash", "landmark-hash"]);
  expect((calls[0] as { refs: string[] }).refs).toEqual(["persona/front.png", "dest/a.jpg"]);
  expect((calls[0] as { seed: number }).seed).not.toBe((calls[1] as { seed: number }).seed);
});

test("video uses selected keyframe and enters clip review", async () => {
  let inputSeen: unknown;
  const context: StageContext = {
    generation_id: "task-2", attempt: 1,
    video: { async generate(input) {
      inputSeen = input;
      return { key: "clip/01_task-2.mp4", model: "MiniMax-H3", version: "hash2",
        seed: input.seed, seconds: 65, ref_hashes: ["keyframe-hash"] };
    } },
  };
  const next = await runVideo(episode({ status: "clipping", shots: [shot({
    status: "generating_clip", candidates: ["kf/01_a.png"], kf_selected: "kf/01_a.png",
  })] }), 1, context);
  expect(next.status).toBe("clip_review");
  expect(next.shots[0]?.status).toBe("clip_ready");
  expect(next.shots[0]?.clip).toBe("clip/01_task-2.mp4");
  expect((inputSeen as { keyframe: string; duration_s: number }).keyframe).toBe("kf/01_a.png");
  expect((inputSeen as { duration_s: number }).duration_s).toBe(3);
});

test("finishing one of several shots leaves the episode generating and preserves other shots", async () => {
  const second = shot({ no: 2, landmark: null, status: "draft" });
  const context: StageContext = {
    persona, destination, generation_id: "task-3", attempt: 1,
    keyframe: { async generate(input) {
      return { key: `kf/01_${input.candidate_no}.png`, model: "Qwen-Image-2.1",
        version: "hash1", seed: input.seed, seconds: 40, ref_hashes: ["h1", "h2"] };
    } },
  };
  const next = await runKeyframe(episode({
    status: "keyframing", shots: [shot({ status: "generating_kf" }), second],
  }), 1, context);
  expect(next.status).toBe("keyframing");
  expect(next.shots[1]).toEqual(second);
});
