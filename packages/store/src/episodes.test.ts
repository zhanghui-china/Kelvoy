import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { close, open } from "./db";
import {
  getEpisode,
  getEpisodeBySlug,
  insertEpisode,
  listEpisodes,
  patchEpisode,
  patchShot,
  replaceEpisode,
  setShare,
} from "./episodes";

function fixtureEpisode(id: string, ownerId = "u_test"): Episode {
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
    scenes: [{ id: "s1", name: "到达", time: "morning", landmarks: [] }],
    shots: [
      {
        no: 1,
        scene: "s1",
        size: "wide",
        beat: "test",
        camera: "static",
        landmark: null,
        kf_prompt: "",
        motion_prompt: "",
        duration_s: 1,
        candidates: [],
        kf_selected: null,
        clip: null,
        trim_start_s: null,
        status: "draft",
        regen_stage: null,
        bad_shot_reported: false,
        model: {},
      },
    ],
    removed_shots: [],
    music: { file: "", bpm: 0, license: "" },
    render: {
      res: "1080x1920",
      fps: 30,
      title: "",
      intro: null,
      outro: null,
      ai_label: true,
    },
  };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

describe("getEpisode / insertEpisode", () => {
  test("legacy JSON resolves portrait aspect, two candidates and empty requirements", async () => {
    const legacy = fixtureEpisode("e_legacy");
    delete (legacy as Partial<Episode>).name;
    delete (legacy as Partial<Episode>).candidate_count;
    delete (legacy.brief as Partial<Episode["brief"]>).requirements;
    delete (legacy.brief as Partial<Episode["brief"]>).aspect;
    await insertEpisode(legacy);
    const got = await getEpisode("e_legacy");
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.episode.candidate_count).toBe(2);
      expect(got.episode.name).toBe("d_test");
      expect(got.episode.brief.requirements).toBe("");
      expect(got.episode.brief.aspect).toBe("9:16");
    }
  });
  test("returns not_found for a missing episode", async () => {
    const result = await getEpisode("e_missing");
    expect(result.ok).toBe(false);
  });

  test("round-trips an inserted episode at row_version 1", async () => {
    await insertEpisode(fixtureEpisode("e_1"));
    const result = await getEpisode("e_1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row_version).toBe(1);
      expect(result.episode.episode_id).toBe("e_1");
    }
  });
});

describe("patchEpisode", () => {
  test("applies a valid patch and bumps row_version", async () => {
    await insertEpisode(fixtureEpisode("e_2"));
    const result = await patchEpisode("e_2", 1, { credits_used: 10 });
    expect(result).toEqual({ ok: true, row_version: 2 });

    const after = await getEpisode("e_2");
    expect(after.ok && after.episode.credits_used).toBe(10);
    expect(after.ok && after.row_version).toBe(2);
  });

  test("rejects a stale row_version with the current one", async () => {
    await insertEpisode(fixtureEpisode("e_3"));
    const result = await patchEpisode("e_3", 999, { credits_used: 10 });
    expect(result).toEqual({ ok: false, error: "version_conflict", current_row_version: 1 });
  });

  test("rejects an illegal status transition", async () => {
    await insertEpisode(fixtureEpisode("e_4"));
    const result = await patchEpisode("e_4", 1, { status: "done" });
    expect(result).toEqual({ ok: false, error: "illegal_transition" });
  });

  test("returns not_found for a missing episode", async () => {
    const result = await patchEpisode("e_missing", 1, { credits_used: 1 });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  test("two writes racing the same row_version: exactly one wins, the other conflicts", async () => {
    // bun:sqlite is synchronous and single-writer, so within one process
    // these two calls can't truly interleave (unlike the Postgres/#10
    // version, which needed a real network race to prove the WHERE-clause
    // guard). That's a property of this simpler architecture, not a gap in
    // the test: whichever call's synchronous read+write runs first commits
    // and bumps row_version; the second sees the now-stale version and is
    // rejected by the same check exercised in the "stale row_version" test
    // above. A true multi-process race would need two separate OS
    // processes writing the same file — out of scope for a unit test.
    await insertEpisode(fixtureEpisode("e_race"));
    const [a, b] = await Promise.all([
      patchEpisode("e_race", 1, { credits_used: 111 }),
      patchEpisode("e_race", 1, { credits_used: 222 }),
    ]);
    const results = [a, b];
    const wins = results.filter((r) => r.ok);
    const conflicts = results.filter((r) => !r.ok && r.error === "version_conflict");
    expect(wins.length).toBe(1);
    expect(conflicts.length).toBe(1);
  });
});

describe("patchShot", () => {
  test("applies a valid patch to the right shot", async () => {
    await insertEpisode(fixtureEpisode("e_5"));
    const result = await patchShot("e_5", 1, 1, { status: "generating_kf" });
    expect(result).toEqual({ ok: true, row_version: 2 });

    const after = await getEpisode("e_5");
    expect(after.ok && after.episode.shots[0].status).toBe("generating_kf");
  });

  test("rejects an illegal shot status transition", async () => {
    await insertEpisode(fixtureEpisode("e_6"));
    const result = await patchShot("e_6", 1, 1, { status: "approved" });
    expect(result).toEqual({ ok: false, error: "illegal_transition" });
  });

  test("returns not_found for a nonexistent shot number", async () => {
    await insertEpisode(fixtureEpisode("e_7"));
    const result = await patchShot("e_7", 999, 1, { status: "generating_kf" });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("replaceEpisode", () => {
  test("writes back a fully-updated episode (e.g. stage output touching scenes/shots)", async () => {
    await insertEpisode(fixtureEpisode("e_8"));
    const updated: Episode = {
      ...fixtureEpisode("e_8"),
      status: "scripting",
      scenes: [{ id: "s2", name: "新场景", time: "noon", landmarks: [] }],
    };
    const result = await replaceEpisode("e_8", 1, updated);
    expect(result).toEqual({ ok: true, row_version: 2 });

    const after = await getEpisode("e_8");
    expect(after.ok && after.episode.scenes[0].id).toBe("s2");
    expect(after.ok && after.episode.status).toBe("scripting");
  });

  test("rejects an illegal status transition even on a full replace", async () => {
    await insertEpisode(fixtureEpisode("e_9"));
    const updated: Episode = { ...fixtureEpisode("e_9"), status: "done" };
    const result = await replaceEpisode("e_9", 1, updated);
    expect(result).toEqual({ ok: false, error: "illegal_transition" });
  });

  test("rejects a stale row_version", async () => {
    await insertEpisode(fixtureEpisode("e_10"));
    const result = await replaceEpisode("e_10", 999, fixtureEpisode("e_10"));
    expect(result).toEqual({ ok: false, error: "version_conflict", current_row_version: 1 });
  });
});

describe("listEpisodes", () => {
  test("only returns the given owner's episodes", async () => {
    await insertEpisode(fixtureEpisode("e_a", "u_1"));
    await insertEpisode(fixtureEpisode("e_b", "u_1"));
    await insertEpisode(fixtureEpisode("e_c", "u_2"));

    const mine = await listEpisodes("u_1");
    expect(mine.map((e) => e.episode_id).sort()).toEqual(["e_a", "e_b"]);
  });

  test("returns an empty array for an owner with no episodes", async () => {
    expect(await listEpisodes("u_nobody")).toEqual([]);
  });
});

describe("getEpisodeBySlug", () => {
  test("finds the episode whose share.slug matches", async () => {
    const withSlug: Episode = { ...fixtureEpisode("e_shared"), share: { enabled: true, slug: "abc123" } };
    await insertEpisode(withSlug);
    await insertEpisode(fixtureEpisode("e_other"));

    const result = await getEpisodeBySlug("abc123");
    expect(result?.episode_id).toBe("e_shared");
  });

  test("returns null for an unknown slug", async () => {
    expect(await getEpisodeBySlug("no-such-slug")).toBeNull();
  });
});

describe("setShare", () => {
  test("enabling for the first time generates a slug", async () => {
    await insertEpisode(fixtureEpisode("e_share"));
    const result = await setShare("e_share", 1, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug.length).toBeGreaterThan(0);

    const stored = await getEpisode("e_share");
    expect(stored.ok && stored.episode.share).toEqual({ enabled: true, slug: result.slug });
  });

  test("disabling then re-enabling reuses the same slug", async () => {
    await insertEpisode(fixtureEpisode("e_share2"));
    const first = await setShare("e_share2", 1, true);
    if (!first.ok) throw new Error("expected ok");

    const off = await setShare("e_share2", 2, false);
    if (!off.ok) throw new Error("expected ok");
    expect(off.slug).toBe(first.slug);

    const backOn = await setShare("e_share2", 3, true);
    if (!backOn.ok) throw new Error("expected ok");
    expect(backOn.slug).toBe(first.slug);
  });

  test("returns not_found for a missing episode", async () => {
    expect(await setShare("e_missing", 1, true)).toEqual({ ok: false, error: "not_found" });
  });

  test("rejects a stale row_version", async () => {
    await insertEpisode(fixtureEpisode("e_share3"));
    const result = await setShare("e_share3", 99, true);
    expect(result).toEqual({ ok: false, error: "version_conflict", current_row_version: 1 });
  });
});
