import { close, open, upsertDestination } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Destination } from "@kelvoy/engine";
import { Hono } from "hono";
import destinations from "./destinations";

function fixture(id: string): Destination {
  return {
    destination_id: id,
    version: 1,
    name: "灵山大佛",
    city: "无锡",
    type: "scenic_area",
    season_best: ["春"],
    landmarks: [{ id: "l1", name: "地标", refs: [`dest/${id}/a.jpg`, `dest/${id}/b.jpg`, `dest/${id}/c.jpg`], best_time: "上午" }],
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/destinations", destinations);
  return app;
}

let tmpRoot: string;

beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-public-dest-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
});

afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

test("lists destinations without requiring login (public library)", async () => {
  await upsertDestination(fixture("d_1"));
  await upsertDestination(fixture("d_2"));

  const app = buildApp();
  const res = await app.request("/api/destinations");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; destinations: Destination[] };
  expect(body.destinations.map((d) => d.destination_id).sort()).toEqual(["d_1", "d_2"]);
});

test("serves a catalog-referenced destination image without login", async () => {
  await upsertDestination(fixture("d_1"));
  const filePath = join(tmpRoot, "projects", "dest", "d_1", "a.jpg");
  await mkdir(join(tmpRoot, "projects", "dest", "d_1"), { recursive: true });
  await writeFile(filePath, "public-landmark-image");

  const res = await buildApp().request("/api/destinations/d_1/assets/dest/d_1/a.jpg");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("public-landmark-image");
});

test("public image route refuses personas, unlisted files, and traversal", async () => {
  await upsertDestination(fixture("d_1"));
  await upsertDestination(fixture("d_2"));
  const app = buildApp();
  expect((await app.request("/api/destinations/d_1/assets/persona/c_private/front.jpg")).status).toBe(400);
  expect((await app.request("/api/destinations/d_1/assets/dest/d_1/unlisted.jpg")).status).toBe(404);
  expect((await app.request("/api/destinations/d_1/assets/dest/d_2/a.jpg")).status).toBe(404);
  expect((await app.request("/api/destinations/d_1/assets/dest/d_1/..%2F..%2Fpersona/c_private/front.jpg")).status).toBe(400);
});
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
