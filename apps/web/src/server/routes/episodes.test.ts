import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dequeueTask, insertEpisode, insertPersona, updatePersona, upsertDestination, upsertTemplate, updateUserSettings } from "@kelvoy/store";
import { expect, test } from "bun:test";
import type { Episode, Persona } from "@kelvoy/engine";
import { estimateCost } from "@kelvoy/engine";
import { resolveArtifactPath } from "./episodes";
import { setupEpisodeRouteTests, buildApp, destinationFixture, fixture, login, personaFixture, templateFixture, tmpRoot } from "./episode-test-fixtures";

setupEpisodeRouteTests();

test("requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/episodes");
  expect(res.status).toBe(401);
});

test("POST rejects grid before any foreign-key lookup", async () => {
  const { cookie } = await login("grid-request");
  const res = await buildApp().request("/api/episodes", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "missing", destination_id: "missing",
      template_id: "missing", mode: "grid" }),
  });
  expect(res.status).toBe(400);
});

test("legacy grid episode remains readable and its existing artifact downloadable", async () => {
  const { cookie, ownerId } = await login("legacy-grid");
  const old = fixture("e_grid", ownerId);
  old.mode = "grid";
  await insertEpisode(old);
  await mkdir(join(tmpRoot, "projects", "e_grid", "final"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_grid", "final", "e_grid.mp4"), "old-video");
  const app = buildApp();
  const loaded = await app.request("/api/episodes/e_grid", { headers: { cookie } });
  expect(loaded.status).toBe(200);
  expect((await loaded.json()).episode.mode).toBe("grid");
  const media = await app.request("/api/episodes/e_grid/files/final/e_grid.mp4", { headers: { cookie } });
  expect(media.status).toBe(200);
  expect(await media.text()).toBe("old-video");
});

test("lists only the logged-in user's own episodes", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_mine", ownerId));
  await insertEpisode(fixture("e_someone_elses", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { episodes: Episode[] };
  expect(body.episodes.map((e) => e.episode_id)).toEqual(["e_mine"]);
});

test("gets one episode by id with its row_version, for owner", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { episode: Episode; row_version: number };
  expect(body.episode.episode_id).toBe("e_1");
  expect(body.row_version).toBe(1);
});

test("404s on someone else's episode instead of leaking that it exists", async () => {
  const { cookie } = await login("dannei");
  await insertEpisode(fixture("e_1", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("404s on a nonexistent episode id", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/episodes/e_missing", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("serves an artifact file under the episode's directory", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));
  await mkdir(join(tmpRoot, "projects", "e_1", "kf"), { recursive: true });
  await writeFile(join(tmpRoot, "projects", "e_1", "kf", "01_a.png"), "fake-png-bytes");

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/files/kf/01_a.png", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("fake-png-bytes");
});

test("404s a missing file under a real episode", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertEpisode(fixture("e_1", ownerId));

  const app = buildApp();
  const res = await app.request("/api/episodes/e_1/files/kf/nope.png", { headers: { cookie } });
  expect(res.status).toBe(404);
});

// A literal ".." never survives to reach the route handler over real HTTP
// (Bun.serve/WHATWG URL normalization collapses dot-segments before Hono
// routes the request — verified separately), so path-traversal payloads
// are exercised directly against resolveArtifactPath() instead of via
// app.request(), which would just have the URL layer neutralize them
// before this code ever ran.
test("resolveArtifactPath rejects .. that climbs above the episode root", () => {
  expect(resolveArtifactPath("e_1", "../../secret.txt")).toBeNull();
  expect(resolveArtifactPath("e_1", "kf/../../../../etc/passwd")).toBeNull();
});

test("resolveArtifactPath folds a leading-slash payload under the root instead of escaping to it", () => {
  const result = resolveArtifactPath("e_1", "/etc/passwd");
  expect(result).toBe(join(tmpRoot, "projects", "e_1", "etc", "passwd"));
});

test("resolveArtifactPath rejects an empty key", () => {
  expect(resolveArtifactPath("e_1", "")).toBeNull();
});

test("resolveArtifactPath accepts a normal nested key", () => {
  const result = resolveArtifactPath("e_1", "kf/01_a.png");
  expect(result).toBe(join(tmpRoot, "projects", "e_1", "kf", "01_a.png"));
});

test("POST creates a fixed-cut draft with intro/outro off and enqueues a brief task", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; episode: Episode };
  const episode = body.episode;

  expect(episode.status).toBe("draft");
  expect(episode.owner_id).toBe(ownerId);
  expect(episode.persona_version).toBe(1);
  expect(episode.destination_version).toBe(1);
  expect(episode.mode).toBe("per_shot"); // FR-01: 默认逐镜
  expect(episode.cut_policy).toBe("fixed_1s");
  // FR-01/FR-09 粗估：建期这一刻没有真实镜数，estimateCost 用它的默认常量。
  expect(episode.estimated_credits).toBe(estimateCost({ mode: "per_shot" }).estimated_credits);
  expect(episode.estimated_credits).toBeGreaterThan(0);
  expect(episode.render.intro).toBeNull();
  expect(episode.render.outro).toBeNull();
  expect(episode.brief.season).toBe("秋"); // 缺省取 destination.season_best[0]
  expect(episode.brief.outfit_override).toBeNull(); // FR-01: 缺省不覆盖角色默认穿搭

  const task = await dequeueTask();
  expect(task?.episode_id).toBe(episode.episode_id);
  expect(task?.stage).toBe("brief");
});

test("POST saves independent name, requirements, aspect and candidate count", async () => {
  const { cookie, ownerId } = await login("wide-owner");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));
  const res = await buildApp().request("/api/episodes", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1",
      name: "宽屏旅行", requirements: "保留地标全景", aspect: "16:9", candidate_count: 1 }),
  });
  expect(res.status).toBe(201);
  const { episode } = await res.json() as { episode: Episode };
  expect(episode.name).toBe("宽屏旅行");
  expect(episode.brief.requirements).toBe("保留地标全景");
  expect(episode.brief.aspect).toBe("16:9");
  expect(episode.render.res).toBe("1920x1080");
  expect(episode.candidate_count).toBe(1);
  expect(episode.estimated_credits).toBe(estimateCost({ mode: "per_shot", candidates: 1 }).estimated_credits);
});

test("POST rejects invalid aspect and candidate count", async () => {
  const { cookie } = await login("invalid-episode");
  for (const value of [{ aspect: "1:1" }, { candidate_count: 0 }, { candidate_count: 4 }, { name: "  " }]) {
    const res = await buildApp().request("/api/episodes", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ persona_id: "c", destination_id: "d", template_id: "t", ...value }),
    });
    expect(res.status).toBe(400);
  }
});

test("POST content checks custom requirements before external lookups", async () => {
  const { cookie } = await login("blocked-requirements");
  const res = await buildApp().request("/api/episodes", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c", destination_id: "d", template_id: "t",
      requirements: "拍摄血腥场面" }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()).violations[0].field).toBe("requirements");
});

test("POST honors an explicit season/tone/banned/mode over the defaults", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      persona_id: "c_1",
      destination_id: "d_1",
      template_id: "t_1",
      season: "春",
      tone: "松弛",
      banned: ["真人"],
      mode: "per_shot",
      outfit_override: "冲锋衣",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { episode: Episode };
  expect(body.episode.brief).toEqual({
    season: "春",
    aspect: "9:16",
    requirements: "",
    duration_s: 30,
    tone: "松弛",
    outfit_override: "冲锋衣",
    banned: ["真人"],
  });
  expect(body.episode.mode).toBe("per_shot");
  expect(body.episode.estimated_credits).toBe(estimateCost({ mode: "per_shot" }).estimated_credits);
});

test("GET /estimate returns a cost estimate for a given mode without touching the db", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();

  const perShotRes = await app.request("/api/episodes/estimate?mode=per_shot", { headers: { cookie } });
  expect(perShotRes.status).toBe(200);
  const perShotBody = (await perShotRes.json()) as { ok: boolean; estimate: unknown };
  expect(perShotBody.estimate).toEqual(estimateCost({ mode: "per_shot" }));

});

test("GET /estimate takes the candidate count from the query (M2-15 出片默认值)", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();

  const res = await app.request("/api/episodes/estimate?mode=per_shot&candidates=3", {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { estimate: unknown };
  expect(body.estimate).toEqual(estimateCost({ mode: "per_shot", candidates: 3 }));

  // 不传 candidates 时行为不变：仍然是 credits.ts 的 DEFAULT_CANDIDATES。
  const noCandidates = await app.request("/api/episodes/estimate?mode=per_shot", {
    headers: { cookie },
  });
  expect((await noCandidates.json()).estimate).toEqual(estimateCost({ mode: "per_shot" }));
});

test("saved candidate count is used while a legacy grid default is ignored", async () => {
  const { cookie, ownerId } = await login("saved-candidates");
  await updateUserSettings(ownerId, { default_candidates: 1, default_mode: "grid" });
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));
  const app = buildApp();
  const estimate = await app.request("/api/episodes/estimate?mode=per_shot", { headers: { cookie } });
  expect((await estimate.json()).estimate).toEqual(estimateCost({ mode: "per_shot", candidates: 1 }));
  const created = await app.request("/api/episodes", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  const saved = (await created.json()).episode as Episode;
  expect(saved.candidate_count).toBe(1);
  expect(saved.mode).toBe("per_shot");
});

test("GET /estimate rejects a candidate count outside 1–3", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();

  for (const value of ["0", "4", "2.5", "abc"]) {
    const res = await app.request(`/api/episodes/estimate?mode=per_shot&candidates=${value}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  }
});

test("GET /estimate rejects a missing or invalid mode", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();

  const missing = await app.request("/api/episodes/estimate", { headers: { cookie } });
  expect(missing.status).toBe(400);

  const invalid = await app.request("/api/episodes/estimate?mode=widescreen", { headers: { cookie } });
  expect(invalid.status).toBe(400);
  const grid = await app.request("/api/episodes/estimate?mode=grid", { headers: { cookie } });
  expect(grid.status).toBe(400);
});

test("GET /estimate requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/episodes/estimate?mode=per_shot");
  expect(res.status).toBe(401);
});

test("POST snapshots the persona version at submit time, not the latest one", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  const body = (await res.json()) as { episode: Episode };
  expect(body.episode.persona_version).toBe(1);

  await updatePersona("c_1", { desc: "改过的描述" }); // bumps to version 2

  const stored = (await (await app.request(`/api/episodes/${body.episode.episode_id}`, { headers: { cookie } })).json()) as {
    episode: Episode;
  };
  expect(stored.episode.persona_version).toBe(1); // 不受之后的角色改动影响
});

test("POST lets a logged-in user select an official persona", async () => {
  const { cookie } = await login("official-user");
  await insertPersona({ ...personaFixture("c_official", "u_other"), owner_id: null });
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));
  const res = await buildApp().request("/api/episodes", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_official", destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(201);
  expect((await res.json() as { episode: Episode }).episode.persona_version).toBe(1);
});

test("GET episode returns its frozen official persona for review after a catalog update", async () => {
  const { cookie, ownerId } = await login("frozen-review");
  await insertPersona({ ...personaFixture("c_official", "u_other"), owner_id: null });
  await insertEpisode({ ...fixture("e_frozen", ownerId), persona_id: "c_official", persona_version: 1 });
  await updatePersona("c_official", {
    name: "新版角色", refs: ["persona/c_official/new.jpg"], style: { lut: "new", title_style: "new" },
  });
  const res = await buildApp().request("/api/episodes/e_frozen", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { episode: Episode; persona: Persona | null };
  expect(body.persona?.version).toBe(1);
  expect(body.persona?.name).toBe(personaFixture("c_official", "u_other").name);
  expect(body.persona?.refs).toEqual(personaFixture("c_official", "u_other").refs);
  expect(body.persona?.style).toEqual(personaFixture("c_official", "u_other").style);
});

test("GET episode does not expose another owner's private persona snapshot", async () => {
  const { cookie, ownerId } = await login("snapshot-isolation");
  await insertPersona(personaFixture("c_private", "u_other"));
  await insertEpisode({ ...fixture("e_imported", ownerId), persona_id: "c_private", persona_version: 1 });
  const res = await buildApp().request("/api/episodes/e_imported", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect((await res.json() as { persona: Persona | null }).persona).toBeNull();
});

test("POST 404s when persona_id doesn't belong to the caller", async () => {
  const { cookie } = await login("dannei");
  await insertPersona(personaFixture("c_1", "u_someone_else"));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(404);
});

test("POST 400s on a missing required field", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ destination_id: "d_1", template_id: "t_1" }),
  });
  expect(res.status).toBe(400);
});

// ---- M1-14: 内容审核关键词拦截 (#29) ----

test("POST 400s with content_blocked when tone hits the keyword blocklist", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));

  const app = buildApp();
  const res = await app.request("/api/episodes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      persona_id: "c_1",
      destination_id: "d_1",
      template_id: "t_1",
      tone: "色情",
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  expect(body.error).toBe("content_blocked");
});

// ---- M2-6: 审片台写路由 ----
