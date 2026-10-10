import type { H3PromptWriter } from "@kelvoy/engine";
import { expect, test } from "bun:test";
import type { Destination, Episode, Persona, Shot } from "../schema";
import { runAssets } from "./assets";
import { runKeyframe } from "./keyframe";
import { runVideo } from "./video";
import type { StageContext } from "./types";

const mockH3PromptWriter: H3PromptWriter = { async write({ context }) { return {
  prompt: "mock official H3 rewritten prompt", provenance: { skill_version: "test", writer_version: "test", model: "test",
    input_hash: "a".repeat(64), ref_hashes: context.references.map(() => "b".repeat(64)), mode: context.mode, duration_s: context.duration_s },
}; } };

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
    name: "测试期", episode_id: "e1", owner_id: "u1", persona_id: "p1", persona_version: 1,
    destination_id: "d1", destination_version: 1, series_id: "s1", template_id: "t1",
    status: "assets", mode: "per_shot", candidate_count: 2, created_at: "2026-09-25T00:00:00Z",
    estimated_credits: 0, credits_used: 0, share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "", outfit_override: null, banned: [] },
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

test("direct reference episodes skip keyframes after validating person and scene", async () => {
  const next = await runAssets(episode({ video_source: "references" }), undefined,
    { persona, destination });
  expect(next.status).toBe("clipping");
  expect(next.shots[0]?.status).toBe("draft");
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

test("saved candidate count and aspect determine keyframe generation", async () => {
  const calls: Array<{ candidate_no: number; aspect?: string }> = [];
  const context: StageContext = {
    persona, destination, generation_id: "task-wide",
    keyframe: { async generate(input) {
      calls.push(input);
      return { key: `kf/${input.candidate_no}.png`, model: "Qwen", version: "1",
        seed: input.seed, seconds: 1, ref_hashes: [] };
    } },
  };
  const next = await runKeyframe(episode({
    candidate_count: 3, brief: { ...episode().brief, aspect: "16:9" },
    status: "keyframing", shots: [shot({ status: "generating_kf" })],
  }), 1, context);
  expect(calls.map((call) => call.candidate_no)).toEqual([0, 1, 2]);
  expect(calls.map((call) => call.aspect)).toEqual(["16:9", "16:9", "16:9"]);
  expect(next.shots[0]?.candidates).toHaveLength(3);
});

test("keyframe generation rejects invalid persisted candidate counts before inference", async () => {
  let calls = 0;
  const context: StageContext = {
    persona, destination, generation_id: "bad-count",
    keyframe: { async generate() {
      calls++;
      throw new Error("inference should not run");
    } },
  };
  for (const candidate_count of [0, 4, 1.5, 1_000_000]) {
    await expect(runKeyframe(episode({ candidate_count, status: "keyframing",
      shots: [shot({ status: "generating_kf" })] }), 1, context)).rejects.toThrow("candidate_count");
  }
  expect(calls).toBe(0);
});

test("video uses selected keyframe and enters clip review", async () => {
  let inputSeen: unknown;
  const context: StageContext = {
    generation_id: "task-2", attempt: 1,
    h3PromptWriter: mockH3PromptWriter,
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
  expect(next.shots[0]?.model.video?.prompt).toBe((inputSeen as { prompt: string }).prompt);
  expect(next.shots[0]?.motion_prompt).toBe("缓慢转身");
  expect(next.shots[0]?.kf_prompt).toBe("角色站在灵山大佛前");
  expect((inputSeen as { keyframe: string; duration_s: number }).keyframe).toBe("kf/01_a.png");
  expect((inputSeen as { duration_s: number }).duration_s).toBe(4);
});

test("direct video sends person and landmark images without a generated keyframe", async () => {
  let inputSeen: unknown;
  const context: StageContext = {
    persona, destination, generation_id: "task-direct", attempt: 1,
    h3PromptWriter: mockH3PromptWriter,
    video: { async generate(input) {
      inputSeen = input;
      return { key: "clip/01_task-direct.mp4", model: "MiniMax-H3", version: "dual",
        seed: input.seed, seconds: 60, ref_hashes: ["person-hash", "scene-hash"] };
    } },
  };
  const next = await runVideo(episode({ video_source: "references", status: "clipping",
    shots: [shot({ status: "generating_clip" })] }), 1, context);
  expect(next.status).toBe("clip_review");
  expect(next.shots[0]?.clip).toBe("clip/01_task-direct.mp4");
  expect((inputSeen as { refs: string[] }).refs).toEqual(["persona/front.png", "dest/a.jpg"]);
  expect(next.shots[0]?.kf_selected).toBeNull();
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

test("video requires prompt writer before inference", async () => {
  await expect(runVideo(episode({ status: "clipping", shots: [shot({ status: "generating_clip", candidates: ["kf/a.png"], kf_selected: "kf/a.png" })] }), 1,
    { generation_id: "g", video: { async generate() { throw new Error("should not run"); } } })).rejects.toThrow("H3");
});


test("video JSON rewrite context keeps source composition, actions and ordered roles", async () => {
  for (const duration of [1.5, 4, 4.1, 10]) {
    let seen: Parameters<H3PromptWriter["write"]>[0] | undefined;
    const original = shot({ size: "detail", camera: "static", beat: "展示烧饼", kf_prompt: "仅手部与烧饼", motion_prompt: "手腕轻微旋转", status: "generating_clip", duration_s: duration });
    const context: StageContext = {
      generation_id: "g", persona, destination,
      h3PromptWriter: { async write(input) { seen = input; return mockH3PromptWriter.write(input); } },
      video: { async generate(input) {
        expect(input.prompt).toBe("mock official H3 rewritten prompt");
        expect(input.duration_s).toBe(duration > 4 ? 5 : 4);
        return { key: "clip/a.mp4", model: "H3", version: "1", seed: input.seed, seconds: 1, ref_hashes: [] };
      } },
    };
    const result = await runVideo(episode({ video_source: "references", status: "clipping", shots: [original] }), 1, context);
    expect(seen!.context).toMatchObject({ mode: "Ref2VA", size: "detail", camera: "static", beat: original.beat, kf_prompt: original.kf_prompt, motion_prompt: original.motion_prompt });
    expect(seen!.context.references).toEqual([{ key: "persona/front.png", role: "person", picture: 1 }, { key: "dest/a.jpg", role: "scene", picture: 2 }]);
    expect(result.shots[0]!.motion_prompt).toBe(original.motion_prompt);
    expect(result.shots[0]!.kf_prompt).toBe(original.kf_prompt);
  }
});
