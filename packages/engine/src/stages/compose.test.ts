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
      return { output_key: plan.output_key,
        probe: { duration_s: 2, width: plan.res.w, height: plan.res.h,
          fps: plan.fps, size_bytes: 2048 } };
    },
  };
}

test("finalOutputKey includes a delivery version", () => {
  expect(finalOutputKey("e_42")).toBe("final/e_42_v1.mp4");
  expect(finalOutputKey("e_42", 2)).toBe("final/e_42_v2.mp4");
});

test("separate execution leases use separate files for the same delivery version", async () => {
  const old = await buildComposePlan(episodeFixture(),
    { persona: personaFixture(), execution_id: "lease_old" });
  const current = await buildComposePlan(episodeFixture(),
    { persona: personaFixture(), execution_id: "lease_new" });
  expect(old.output_key).toBe("final/e_1_v1_lease_old.mp4");
  expect(current.output_key).toBe("final/e_1_v1_lease_new.mp4");
});

test("buildComposePlan compiles an episode into a backend-agnostic plan", async () => {
  const plan = await buildComposePlan(episodeFixture(), { persona: personaFixture() });

  expect(plan.output_key).toBe("final/e_1_v1.mp4");
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

test("new fixed-cut projects keep 30 frames per shot when music changes", async () => {
  const episode = episodeFixture({ cut_policy: "fixed_1s", shots: [shotFixture(1, { trim_start_s: 0.06 }), shotFixture(2)] });
  const slow = await buildComposePlan(episode, { persona: personaFixture() });
  const fast = await buildComposePlan({ ...episode, music: { file: "music/fast.mp3", bpm: 160, license: "自有" } }, { persona: personaFixture() });
  expect(slow.cuts).toEqual(fast.cuts);
  expect(slow.cuts.map((cut) => cut.frame_count)).toEqual([30, 30]);
  expect(totalCutDurationS(slow.cuts)).toBe(2);
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
  expect(provider.calls[0]?.output_key).toBe("final/e_1_v1.mp4");
  expect(updated.status).toBe("done");
  expect(updated.final).toMatchObject({ version: 1, key: "final/e_1_v1.mp4",
    duration_s: 2, width: 1080, height: 1920, fps: 30, size_bytes: 2048 });
  // 选中的曲子回写进期记录（license 留痕、bpm 供重新合成复用同一套切点）。
  expect(updated.music).toEqual({ file: "music/calm_morning.mp3", bpm: 84, license: "Kelvoy original" });
  // 重新合成不动任何镜（PRD §4）。
  expect(updated.shots).toEqual(episodeFixture().shots);
});

test("recompose writes a new version and leaves the previous artifact reference intact until success", async () => {
  const previous = { version: 1, key: "final/e_1_v1.mp4", duration_s: 2,
    width: 1080, height: 1920, fps: 30, size_bytes: 1000,
    completed_at: "2026-09-25T00:00:00Z" };
  const episode = episodeFixture({ final: previous });
  const provider = fakeComposeProvider();
  const updated = await runCompose(episode, undefined, { persona: personaFixture(), compose: provider });
  expect(provider.calls[0]?.output_key).toBe("final/e_1_v2.mp4");
  expect(updated.final?.version).toBe(2);
  expect(episode.final).toEqual(previous);
});

test("runCompose refuses to run without a ComposeProvider (engine never touches ffmpeg)", async () => {
  await expect(runCompose(episodeFixture(), undefined, { persona: personaFixture() })).rejects.toThrow(
    "compose 阶段需要 ComposeProvider",
  );
});

for (const policy of ["fixed_1s", "beat_aligned"] as const) {
  test(`${policy} carries captions in shot order without changing trims`, async () => {
    const episode = episodeFixture({ cut_policy: policy, music: { file: "music/test.mp3", bpm: 120, license: "test" }, shots: [
      shotFixture(7, { caption: "中文\n引号' : , {测试} \\ 路", trim_start_s: 0.5, duration_s: 2 }),
      shotFixture(2, { caption: "  ", trim_start_s: 1, duration_s: 1 }),
      shotFixture(9),
    ] });
    const plan = await buildComposePlan(episode, { persona: personaFixture() });
    expect(plan.subtitles_enabled).toBe(true);
    expect(plan.cuts.map(c => c.no)).toEqual([7, 2, 9]);
    expect(plan.cuts.map(c => c.caption)).toEqual([episode.shots[0]!.caption, "  ", ""]);
    expect(plan.cuts.map(c => c.trim_start_s)).toEqual([0.5, 1, 0]);
    expect(plan.cuts.map(c => c.duration_s)).toEqual(policy === "fixed_1s" ? [1, 1, 1] : [2, 1, 1]);
    for (const enabled of [true, false]) {
      const explicit = await buildComposePlan({ ...episode, render: { ...episode.render, subtitles_enabled: enabled } }, { persona: personaFixture() });
      expect(explicit.subtitles_enabled).toBe(enabled);
    }
  });
}

test("legacy subtitles survive an explicitly enabled compose", async () => {
  const episode = episodeFixture({ shots: [shotFixture(1, { caption: "字幕" })] });
  episode.render.subtitles_enabled = true;
  const plan = await buildComposePlan(episode, { persona: personaFixture() });
  expect(plan.cuts[0]?.caption).toBe("字幕");
});

test("restored long policy probes actual media and keeps old long suggestions", async () => {
  const episode = episodeFixture({ cut_policy: "long_3_6", shots: Array.from({length:7}, (_, i) => shotFixture(i+1, {duration_s:4, caption:`字幕${i}`})),
    music: {file:"music/test.mp3",bpm:120,license:"test"} });
  const compose: ComposeProvider = { ...fakeComposeProvider(), async probeMedia(input) {
    expect(input.clips.map(c => c.clip_key)).toEqual(episode.shots.map(s => s.clip!));
    return { clip_duration_s: Object.fromEntries(input.clips.map(c => [c.no, 5])), intro_duration_s: 1, outro_duration_s: 1 };
  } };
  const before = JSON.stringify(episode);
  const plan = await buildComposePlan(episode, {persona:personaFixture(),compose});
  expect(totalCutDurationS(plan.cuts)).toBe(28);
  expect(plan.intro_frame_count).toBe(30);
  expect(plan.outro_frame_count).toBe(30);
  expect(plan.cuts.every(c => c.duration_s >= 3 && c.duration_s <= 5)).toBe(true);
  expect(plan.subtitles_enabled).toBe(true);
  expect(plan.transitions_enabled).toBe(false);
  expect(JSON.stringify(episode)).toBe(before);
  await expect(buildComposePlan(episode, {persona:personaFixture()})).rejects.toThrow("探测");
});

test("long output outside duration tolerance cannot replace an old delivery", async () => {
  const old = {version:1,key:"final/old.mp4",duration_s:30,width:1080,height:1920,fps:30,size_bytes:1000,completed_at:"2026-09-29"};
  const episode = episodeFixture({cut_policy:"long_3_6",final:old,shots:Array.from({length:7}, (_,i) => shotFixture(i+1,{duration_s:4}))});
  const compose: ComposeProvider = { ...fakeComposeProvider(), async probeMedia() {
    return {clip_duration_s:Object.fromEntries(episode.shots.map(s => [s.no,5])),intro_duration_s:0,outro_duration_s:0};
  } };
  await expect(runCompose(episode,undefined,{persona:personaFixture(),compose})).rejects.toThrow("成片实际");
  expect(episode.final).toEqual(old);
});
