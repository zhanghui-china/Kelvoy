import { expect, test } from "bun:test";
import { getEpisode, insertEpisode, enqueueTask, failTask } from "@kelvoy/store";
import { MUSIC_CATALOG } from "@kelvoy/engine";
import { buildApp, fixture, login, setupEpisodeRouteTests } from "./episode-test-fixtures";

setupEpisodeRouteTests();
test("music changes preserve an old final, retain an omitted switch and reject stale saves", async () => {
  const owner = await login("music-save");
  const episode = fixture("e_music", owner.ownerId);
  episode.status = "done";
  Object.assign(episode.music, { enabled: false });
  episode.final = {version:1,key:"final/old.mp4",duration_s:30,width:1080,height:1920,fps:30,size_bytes:10,completed_at:"2026-10-10"};
  await insertEpisode(episode);
  const app = buildApp();
  const save = (music: object, row_version: number) => app.request("/api/episodes/e_music", {method:"PATCH",
    headers:{cookie:owner.cookie,"content-type":"application/json"},body:JSON.stringify({row_version,patch:{music}})});
  const {tones, ...track} = MUSIC_CATALOG[1]!;
  expect((await save(track,1)).status).toBe(200);
  const got = await getEpisode(episode.episode_id); if (!got.ok) throw Error("missing");
  expect(got.episode.music).toEqual({...track,enabled:false});
  expect(got.episode.final_needs_recompose).toBe(true);
  expect(got.episode.final).toEqual(episode.final);
  expect((await save({...track,enabled:true},1)).status).toBe(409);
  expect((await save({...track,enabled:"false"},got.row_version)).status).toBe(400);
});

test.each(["compose", "video"] as const)("failed %s tasks only allow composition settings for compose failures", async stage => {
  const owner = await login(`music-failed-${stage}`);
  const episode = fixture("e_music_failed", owner.ownerId);
  episode.status = "failed";
  await insertEpisode(episode);
  const task = await enqueueTask({episode_id:episode.episode_id,stage});
  await failTask(task.task_id,{requeue:false});
  const response = await buildApp().request(`/api/episodes/${episode.episode_id}`, {method:"PATCH",
    headers:{cookie:owner.cookie,"content-type":"application/json"},body:JSON.stringify({row_version:1,
      patch:{music:{...episode.music,enabled:false}}})});
  expect(response.status).toBe(stage === "compose" ? 200 : 400);
});

test("a legacy selected track can be disabled without clearing its selection", async () => {
  const owner = await login("music-legacy");
  const episode = fixture("e_music_legacy",owner.ownerId);
  episode.status = "compose_ready";
  episode.music = {file:"music/legacy.mp3",bpm:110,license:"legacy"};
  await insertEpisode(episode);
  const response = await buildApp().request(`/api/episodes/${episode.episode_id}`, {method:"PATCH",
    headers:{cookie:owner.cookie,"content-type":"application/json"},body:JSON.stringify({row_version:1,
      patch:{music:{...episode.music,enabled:false}}})});
  expect(response.status).toBe(200);
});
