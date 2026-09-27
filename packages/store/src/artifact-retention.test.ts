import { afterEach, expect, test } from "bun:test";
import { close, getDb, open } from "./db";
import { getArtifactRetentionSnapshot, listArtifactEpisodeIds } from "./artifact-retention";

afterEach(() => close());

test("artifact snapshot retains current, removed, grid and legacy final keys", () => {
  open(":memory:");
  const doc = { status: "done", grid_refs: ["grid/old.png"],
    shots: [{ candidates: ["kf/current.png"], kf_selected: "kf/selected.png", clip: "clip/current.mp4" }],
    removed_shots: [{ candidates: ["kf/removed.png"], kf_selected: null, clip: "clip/removed.mp4" }],
    final: null };
  getDb().query("insert into episodes (episode_id, owner_id, row_version, doc) values ('e_history', 'u', 1, ?)")
    .run(JSON.stringify(doc));
  expect(listArtifactEpisodeIds()).toEqual(["e_history"]);
  expect(getArtifactRetentionSnapshot("e_history")).toEqual({ hasUnsettledTasks: false,
    references: ["grid/old.png", "kf/current.png", "kf/selected.png", "clip/current.mp4",
      "kf/removed.png", "clip/removed.mp4", "final/e_history.mp4"] });
  getDb().query(`insert into tasks (task_id, episode_id, stage, attempt, status)
    values ('tk_failed', 'e_history', 'keyframe', 1, 'failed')`).run();
  expect(getArtifactRetentionSnapshot("e_history")?.hasUnsettledTasks).toBe(true);
});
