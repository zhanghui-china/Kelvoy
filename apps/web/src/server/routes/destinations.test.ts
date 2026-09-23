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
    landmarks: [{ id: "l1", name: "地标", refs: ["a.jpg", "b.jpg", "c.jpg"], best_time: "上午" }],
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

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
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
