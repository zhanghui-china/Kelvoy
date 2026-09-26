import type { Episode, Shot, ShotStatus } from "@kelvoy/engine";
import { expect, test } from "bun:test";
import { episodeLabel, weekRange, weekStats } from "./episode-view";

function shot(no: number, status: ShotStatus): Shot {
  return {
    no,
    scene: "s1",
    size: "wide",
    beat: "到达",
    camera: "static",
    landmark: null,
    kf_prompt: "",
    motion_prompt: "",
    duration_s: 1.2,
    candidates: [],
    kf_selected: null,
    clip: null,
    trim_start_s: null,
    status,
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
  };
}

function fixture(p: {
  id: string;
  created_at: string;
  status?: Episode["status"];
  credits_used?: number;
  shots?: Shot[];
  title?: string;
  name?: string;
}): Episode {
  return {
    name: p.name ?? "测试期", episode_id: p.id,
    owner_id: "u_owner",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status: p.status ?? "draft",
    mode: "per_shot", candidate_count: 2,
    created_at: p.created_at,
    estimated_credits: 0,
    credits_used: p.credits_used ?? 0,
    share: { enabled: false, slug: "" },
    brief: { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "松弛", outfit_override: null, banned: [] },
    grid_refs: [],
    scenes: [],
    shots: p.shots ?? [],
    removed_shots: [],
    music: { file: "", bpm: 120, license: "cc0" },
    render: { res: "1080x1920", fps: 30, title: p.title ?? "", intro: null, outro: null, ai_label: true },
  };
}

test("episodeLabel uses the episode name independently of the film title", () => {
  expect(episodeLabel(fixture({ id: "e_1", created_at: "2026-09-23T10:00:00",
    name: "我的旅行", title: "无锡三日" }))).toBe("我的旅行");
  const legacy = fixture({ id: "e_2", created_at: "2026-09-23T10:00:00", title: "旧标题" });
  delete (legacy as Partial<Episode>).name;
  expect(episodeLabel(legacy)).toBe("旧标题");
  legacy.render.title = "";
  expect(episodeLabel(legacy)).toBe("e_2");
});

test("weekRange starts on the local Monday and ends on the next Monday", () => {
  // 2026-09-24 是周四；这一自然周是 09-21(一) 00:00 ~ 09-28(一) 00:00。
  const { start, end } = weekRange(new Date(2026, 8, 24, 15, 30));
  expect(new Date(start).toString()).toBe(new Date(2026, 8, 21).toString());
  expect(new Date(end).toString()).toBe(new Date(2026, 8, 28).toString());
});

test("weekRange treats Sunday as the last day of the week, not the first", () => {
  const { start } = weekRange(new Date(2026, 8, 27, 23, 59)); // 周日
  expect(new Date(start).toString()).toBe(new Date(2026, 8, 21).toString());
});

test("weekStats counts only episodes created inside the current week", () => {
  const now = new Date(2026, 8, 24, 12, 0); // 周四
  const episodes = [
    fixture({
      id: "e_in_done",
      created_at: new Date(2026, 8, 22, 9, 0).toISOString(),
      status: "done",
      credits_used: 12,
      shots: [shot(1, "approved"), shot(2, "approved"), shot(3, "draft")],
    }),
    fixture({
      id: "e_in_running",
      created_at: new Date(2026, 8, 24, 8, 0).toISOString(),
      status: "kf_review",
      credits_used: 5,
      shots: [shot(1, "approved"), shot(2, "kf_ready")],
    }),
    fixture({
      id: "e_last_week",
      created_at: new Date(2026, 8, 20, 9, 0).toISOString(), // 上周日
      status: "done",
      credits_used: 99,
      shots: [shot(1, "approved")],
    }),
  ];

  expect(weekStats(episodes, now)).toEqual({ doneEpisodes: 1, gpuMinutes: 17, approvedShots: 3 });
});

test("weekStats returns zeros with no episodes, and skips unparseable created_at", () => {
  const now = new Date(2026, 8, 24, 12, 0);
  expect(weekStats([], now)).toEqual({ doneEpisodes: 0, gpuMinutes: 0, approvedShots: 0 });
  expect(weekStats([fixture({ id: "e_bad", created_at: "not-a-date", credits_used: 7 })], now)).toEqual({
    doneEpisodes: 0,
    gpuMinutes: 0,
    approvedShots: 0,
  });
});
