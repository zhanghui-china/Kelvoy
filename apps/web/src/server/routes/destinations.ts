import { listDestinations } from "@kelvoy/store";
import { Hono } from "hono";

// FR-14: 目的地库（官方维护，公共只读，不按 owner 过滤）。
const destinations = new Hono();

destinations.get("/", async (c) => {
  return c.json({ ok: true, destinations: await listDestinations() });
});

export default destinations;
