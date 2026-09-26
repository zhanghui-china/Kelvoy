import { expect, test } from "bun:test";
import type { ComposePlan, ComposeProvider } from "../providers/types";
import { totalCutDurationS } from "../rules/beat";
import type { Episode, Persona, Shot } from "../schema";
import { AI_LABEL_TEXT, buildComposePlan, finalOutputKey, runCompose } from "./compose";

function shotFixture(no: number, overrides: Partial<Shot> = {}): Shot {
  return {
    no,
    scene: "sc_1",
    size: "wide",
    beat: "抵达",
    camera: "static",
    landmark: null,
    kf_prompt: "",
    motion_prompt: "",
    duration_s: 1.2,
    candidates: [],
    kf_selected: null,
    clip: `clip/${String(no).padStart(2, "0")}.mp4`,
    trim_start_s: 0,
    status: "approved",
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
    ...overrides,
  };
}

function personaFixture(): Persona {
  return {
    persona_id: "c_1",
    owner_id: "u_1",
    version: 3,
    name: "小可",
    desc: "",
    locked: [],
    default_outfit: "",
    refs: [],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

function episodeFixture(overrides: Partial<Episode> = {}): Episode {
  return {
    name: "测试期", episode_id: "e_1",
    owner_id: "u_1",
    persona_id: "c_1",
    persona_version: 3,
    destination_id: "d_1",
    destination_version: 2,
    series_id: "s_1",
    template_id: "t_1",
    status: "composing",
    mode: "per_shot", candidate_count: 2,
    created_at: "2026-09-24T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "松弛", outfit_override: null, banned: [] },
    grid_refs: [],
    scenes: [],
    shots: [shotFixture(1), shotFixture(2)],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: {
      res: "1080x1920",
      fps: 30,
      title: "黄山",
      intro: "intro/default.mp4",
      outro: "outro/default.mp4",
      ai_label: true,
    },
    ...overrides,
  };
}

function fakeComposeProvider(): ComposeProvider & { calls: ComposePlan[] } {
  const calls: ComposePlan[] = [];
  return {
    calls,
    async compose({ plan }) {
      calls.push(plan);
      return { output_key: plan.output_key };
    },
  };
}

test("finalOutputKey is a derived convention, not a schema field", () => {
  expect(finalOutputKey("e_42")).toBe("final/e_42.mp4");
});

test("buildComposePlan compiles an episode into a backend-agnostic plan", async () => {
  const plan = await buildComposePlan(episodeFixture(), { persona: personaFixture() });

  expect(plan.output_key).toBe("final/e_1.mp4");
  expect(plan.res).toEqual({ w: 1080, h: 1920 });
  expect(plan.fps).toBe(30);
  expect(plan.lut_key).toBe("lut/warm_film.cube");
  expect(plan.title_style).toBe("serif-center");
  expect(plan.intro_key).toBe("intro/default.mp4");
  expect(plan.outro_key).toBe("outro/default.mp4");
  expect(plan.cuts.map((c) => c.clip_key)).toEqual(["clip/01.mp4", "clip/02.mp4"]);
});

test("buildComposePlan carries both AI-label layers (watermark + metadata, PRD §8)", async () => {
  const plan = await buildComposePlan(episodeFixture(), { persona: personaFixture() });

  expect(plan.ai_label).toBe(true);
  expect(plan.ai_label_text).toBe(AI_LABEL_TEXT);
  expect(plan.metadata).toEqual({
    comment: AI_LABEL_TEXT,
    ai_generated: "true",
    kelvoy_episode_id: "e_1",
    kelvoy_persona_version: "3",
    kelvoy_destination_version: "2",
  });
});

test("buildComposePlan beat-aligns every cut against the selected track's bpm", async () => {
  const plan = await buildComposePlan(episodeFixture(), { persona: personaFixture() });

  // tone "松弛" -> calm_morning @ 84 bpm -> 0.714 s/beat; 目标 1.2 s 最近的
  // 整拍是 2 拍（1.429 s），仍在 FR-07 的 0.8–2.0 s 窗口里。
  expect(plan.music?.bpm).toBe(84);
  for (const cut of plan.cuts) {
    expect(cut.duration_s).toBeGreaterThanOrEqual(0.8);
    expect(cut.duration_s).toBeLessThanOrEqual(2);
  }
  // 验收口径：成片时长 = Σ 单镜实际时长 + 片头片尾。片头片尾长度是素材属性
  // （worker 用 ffprobe 量），plan 这一层只负责把 Σ 定死。
  expect(totalCutDurationS(plan.cuts)).toBe(2.858);
});

test("buildComposePlan keeps a track the user already picked instead of re-selecting", async () => {
  const episode = episodeFixture({ music: { file: "music/mine.mp3", bpm: 120, license: "自有授权" } });
  const plan = await buildComposePlan(episode, { persona: personaFixture() });

  expect(plan.music).toEqual({ file_key: "music/mine.mp3", bpm: 120, license: "自有授权" });
  // 120 bpm -> 0.5 s/beat，目标 1.2 s 吸到 1.0 s：换曲会换切点，符合"卡拍优先"。
  expect(plan.cuts[0]?.duration_s).toBe(1);
});

test("buildComposePlan refuses an episode with a shot that isn't approved", async () => {
  const episode = episodeFixture({ shots: [shotFixture(1), shotFixture(2, { status: "clip_ready" })] });
  await expect(buildComposePlan(episode, { persona: personaFixture() })).rejects.toThrow("第 2 镜未 approved");
});

test("buildComposePlan demands a persona for the account-level LUT", async () => {
  await expect(buildComposePlan(episodeFixture())).rejects.toThrow("compose 阶段需要 persona");
});

test("runCompose hands the plan to the injected provider and advances composing -> done", async () => {
  const provider = fakeComposeProvider();
  const updated = await runCompose(episodeFixture(), undefined, { persona: personaFixture(), compose: provider });

  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]?.output_key).toBe("final/e_1.mp4");
  expect(updated.status).toBe("done");
  // 选中的曲子回写进期记录（license 留痕、bpm 供重新合成复用同一套切点）。
  expect(updated.music).toEqual({ file: "music/calm_morning.mp3", bpm: 84, license: "CC0-1.0" });
  // 重新合成不动任何镜（PRD §4）。
  expect(updated.shots).toEqual(episodeFixture().shots);
});

test("runCompose refuses to run without a ComposeProvider (engine never touches ffmpeg)", async () => {
  await expect(runCompose(episodeFixture(), undefined, { persona: personaFixture() })).rejects.toThrow(
    "compose 阶段需要 ComposeProvider",
  );
});
