import { expect, test } from "bun:test";
import { updateMutationVersion, versionForEpisode } from "./episode-mutation-version";

test("mutation versions advance within one episode and reset on another episode", () => {
  const first = updateMutationVersion({ episodeId: "e_one", rowVersion: 9 }, "e_one", 3);
  expect(first).toEqual({ episodeId: "e_one", rowVersion: 9 });
  expect(updateMutationVersion(first, "e_two", 1)).toEqual({ episodeId: "e_two", rowVersion: 1 });
});

test("a stale detail response cannot initialize the new episode's mutation version", () => {
  expect(versionForEpisode("e_two", { episode: { episode_id: "e_one" }, row_version: 9 })).toBe(0);
  expect(versionForEpisode("e_two", { episode: { episode_id: "e_two" }, row_version: 2 })).toBe(2);
});
