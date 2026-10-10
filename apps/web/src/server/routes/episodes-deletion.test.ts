import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { insertEpisode, getCreditBalance, grantCredits, reserveCredits } from "@kelvoy/store";
import { Hono } from "hono";
import share from "./share";
import {
  setupEpisodeRouteTests, buildApp, fixture, login, tmpRoot,
} from "./episode-test-fixtures";

setupEpisodeRouteTests();

test("DELETE requires authentication and hides missing or foreign episodes", async () => {
  const app = buildApp();
  expect((await app.request("/api/episodes/e_delete", { method: "DELETE" })).status).toBe(401);
  const { cookie } = await login("delete-api-ownership");
  await insertEpisode(fixture("e_other", "other"));

  for (const id of ["e_other", "missing"]) {
    const response = await app.request(`/api/episodes/${id}`, {
      method: "DELETE", headers: { cookie },
    });
    expect(response.status).toBe(404);
  }
});

test("DELETE refunds once and immediately revokes accessible details, shares and downloads", async () => {
  const { cookie, ownerId } = await login("delete-api");
  await insertEpisode({
    ...fixture("e_delete", ownerId), status: "done",
    share: { enabled: true, slug: "delete-slug" },
  });
  const finalDirectory = join(tmpRoot, "projects", "e_delete", "final");
  await mkdir(finalDirectory, { recursive: true });
  await writeFile(join(finalDirectory, "e_delete.mp4"), "final-video");
  grantCredits(ownerId, 10, "delete-grant");
  reserveCredits({
    action_id: "script", user_id: ownerId, episode_id: "e_delete", kind: "script", units: 1,
  });
  const app = buildApp();
  const publicApp = new Hono();
  publicApp.route("/api/share", share);
  const detailPath = "/api/episodes/e_delete";
  const ownedDownloadPath = "/api/episodes/e_delete/files/final/e_delete.mp4";
  const sharePath = "/api/share/delete-slug";
  const publicDownloadPath = "/api/share/delete-slug/final.mp4";

  expect((await app.request(detailPath, { headers: { cookie } })).status).toBe(200);
  const ownedDownload = await app.request(ownedDownloadPath, { headers: { cookie } });
  expect(ownedDownload.status).toBe(200);
  expect(await ownedDownload.text()).toBe("final-video");
  expect((await publicApp.request(sharePath)).status).toBe(200);
  const publicDownload = await publicApp.request(publicDownloadPath);
  expect(publicDownload.status).toBe(200);
  expect(await publicDownload.text()).toBe("final-video");

  const result = await app.request(detailPath, { method: "DELETE", headers: { cookie } });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true, cleanup_status: "pending", refunded_credits: 1 });
  expect((await app.request(detailPath, { headers: { cookie } })).status).toBe(404);
  expect((await app.request(ownedDownloadPath, { headers: { cookie } })).status).toBe(404);
  expect((await publicApp.request(sharePath)).status).toBe(404);
  expect((await publicApp.request(publicDownloadPath)).status).toBe(404);

  const repeated = await app.request(detailPath, { method: "DELETE", headers: { cookie } });
  expect(await repeated.json()).toEqual({ ok: true, cleanup_status: "pending", refunded_credits: 0 });
  expect(getCreditBalance(ownerId)).toEqual({ available: 1010, reserved: 0 });
});
