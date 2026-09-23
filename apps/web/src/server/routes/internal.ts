import { Hono } from "hono";

/**
 * Worker-facing routes (PRD v0.2 §9, docs/contracts/internal-api.md).
 * apps/worker is the only caller — reached outbound-only from DGX, never
 * exposed to the public internet. Handlers are 501 until Postgres access
 * is wired up (M1-1 scope is the contract + auth, not persistence).
 */
const internal = new Hono();

// Worker-only token auth. Every route under this prefix requires it —
// there is no per-route opt-out.
internal.use("*", async (c, next) => {
  const expected = process.env.WORKER_INTERNAL_TOKEN;
  const given = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!expected || !given || given !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

// GetEpisodeResponse
internal.get("/episodes/:id", (c) => {
  return c.json({ error: "not implemented" }, 501);
});

// PatchEpisodeRequest -> PatchEpisodeResponse | VersionConflict
internal.patch("/episodes/:id", (c) => {
  return c.json({ error: "not implemented" }, 501);
});

// PatchShotRequest -> PatchShotResponse | VersionConflict
internal.patch("/episodes/:id/shots/:no", (c) => {
  return c.json({ error: "not implemented" }, 501);
});

export default internal;
