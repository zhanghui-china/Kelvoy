import { getDestination, listDestinations } from "@kelvoy/store";
import { Hono } from "hono";
import { resolveAssetPath } from "./assets";

// FR-14: 目的地库（官方维护，公共只读，不按 owner 过滤）。
const destinations = new Hono();

destinations.get("/", async (c) => {
  return c.json({ ok: true, destinations: await listDestinations() });
});

// Public marketing cards may only serve images referenced by this destination's
// catalog record. The authenticated /api/assets route remains the only path to
// persona references and episode artifacts.
destinations.get("/:id/assets/:path{.+}", async (c) => {
  const key = c.req.param("path");
  if (!key.startsWith("dest/")) return c.json({ ok: false, error: "invalid_path" }, 400);
  const filePath = resolveAssetPath(key);
  if (!filePath) return c.json({ ok: false, error: "invalid_path" }, 400);

  const destination = await getDestination(c.req.param("id"));
  if (!destination || !destination.landmarks.some((landmark) => landmark.refs.includes(key))) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  const file = Bun.file(filePath);
  if (!(await file.exists())) return c.json({ ok: false, error: "not_found" }, 404);
  return new Response(file, { headers: { "Cache-Control": "public, max-age=3600" } });
});

export default destinations;
