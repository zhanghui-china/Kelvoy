import { expect, test } from "bun:test";
import { insertEpisode, upsertDestination, getCreditBalance } from "@kelvoy/store";
import { buildApp, destinationFixture, fixture, login, setupEpisodeRouteTests, shotFixture } from "./episode-test-fixtures";
setupEpisodeRouteTests();
test("suggestion API queues owned versioned requests and protects status polling", async () => {
  const owner = await login("suggest-owner");
  const stranger = await login("suggest-stranger");
  await upsertDestination(destinationFixture("d_test"));
  const episode = { ...fixture("e_suggest", owner.ownerId), status: "done" as const,
    scenes: [{ id: "sc1", name: "清晨", time: "morning" as const, landmarks: [] }],
    shots: [shotFixture(1, { shot_id: "sh_1", status: "approved" })] };
  await insertEpisode(episode);
  const app = buildApp();
  const request = { row_version: 1, after_shot_id: "sh_1", description: "沿石板路步行", fields: {} };
  const post = (cookie: string, body: unknown) => app.request("/api/episodes/e_suggest/storyboard/suggestions", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  expect((await post(stranger.cookie, request)).status).toBe(404);
  expect((await post(owner.cookie, { ...request, row_version: 0 })).status).toBe(400);
  const response = await post(owner.cookie, request);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.row_version).toBe(2);
  expect(getCreditBalance(owner.ownerId).reserved).toBe(1);
  expect((await post(owner.cookie, request)).status).toBe(409);
  const path = `/api/episodes/e_suggest/storyboard/suggestions/${result.task_id}`;
  expect((await app.request(path, { headers: { cookie: stranger.cookie } })).status).toBe(404);
  expect(await (await app.request(path, { headers: { cookie: owner.cookie } })).json()).toEqual({ ok: true, status: "pending" });
});
