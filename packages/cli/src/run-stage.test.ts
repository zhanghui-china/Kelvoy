import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Episode, EpisodeStatus } from "@kelvoy/engine";
import { close, getEpisode, insertEpisode, open } from "@kelvoy/store";
import { runEpisodeStage } from "./run-stage";

function fixtureEpisode(id: string, status: EpisodeStatus): Episode {
  return {
    episode_id: id,
    owner_id: "u_test",
    persona_id: "c_test",
    persona_version: 1,
    destination_id: "d_test",
    destination_version: 1,
    series_id: "s_test",
    template_id: "t_test",
    status,
    mode: "per_shot",
    created_at: "2026-09-23T00:00:00+08:00",
    estimated_credits: 0,
    credits_used: 0,
    share: { enabled: false, slug: "" },
    brief: {
      season: "秋",
      aspect: "9:16",
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

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("returns an error for a missing episode", async () => {
  const result = await runEpisodeStage("e_missing", "brief");
  expect(result).toEqual({ ok: false, error: "期不存在：e_missing" });
});

test("refuses to run a stage when the episode can't advance (terminal state)", async () => {
  await insertEpisode(fixtureEpisode("e_done", "done"));
  const result = await runEpisodeStage("e_done", "compose");
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error).toContain("无法推进");

  // No write happened.
  const after = await getEpisode("e_done");
  expect(after.ok && after.row_version).toBe(1);
});

test("stage failure from a non-generating status (draft) reports the error without crashing", async () => {
  await insertEpisode(fixtureEpisode("e_draft", "draft"));
  const result = await runEpisodeStage("e_draft", "brief");
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error).toContain("阶段 brief 失败");

  // "failed" isn't reachable from "draft" (not a generating state) — the
  // best-effort patch silently no-ops, status stays "draft".
  const after = await getEpisode("e_draft");
  expect(after.ok && after.episode.status).toBe("draft");
});

test("stage failure from a generating status marks the episode failed", async () => {
  await insertEpisode(fixtureEpisode("e_scripting", "scripting"));
  const result = await runEpisodeStage("e_scripting", "script");
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error).toContain("阶段 script 失败");

  const after = await getEpisode("e_scripting");
  expect(after.ok && after.episode.status).toBe("failed");
});
