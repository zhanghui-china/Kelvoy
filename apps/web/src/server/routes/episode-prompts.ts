import { listPromptTraces } from "@kelvoy/store";
import { Hono } from "hono";
import type { PromptTracesResponse } from "../../shared/prompt-traces";
import { loadOwnedEpisode } from "./episode-common";
import { legacyNote, toPromptTraceView } from "./episode-prompts-view";

// ADR-0012: owner-only, read-only prompt records. Rows are redacted by
// episode-prompts-view.ts; this module must not be reused by share/export routes.
const prompts = new Hono();

const SHOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

prompts.get("/:id/prompts", async (c) => {
  c.header("Cache-Control", "no-store");
  const ownerId = c.get("ownerId");
  const episodeId = c.req.param("id");
  const loaded = await loadOwnedEpisode(ownerId, episodeId);
  if (!loaded) return c.json({ ok: false, error: "not_found" }, 404);

  const kind = c.req.query("kind");
  if (kind !== "script" && kind !== "video") return c.json({ ok: false, error: "invalid_kind" }, 400);

  const shotId = c.req.query("shot_id");
  if (shotId !== undefined && (kind === "script" || !SHOT_ID_PATTERN.test(shotId))) {
    return c.json({ ok: false, error: "invalid_shot_id" }, 400);
  }

  const rawLimit = c.req.query("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    // Digits only; absurdly long values are still integers and clamp like any other oversize.
    if (!/^[0-9]+$/.test(rawLimit) || Number(rawLimit) < 1) return c.json({ ok: false, error: "invalid_limit" }, 400);
    limit = Math.min(Number(rawLimit), MAX_LIMIT);
  }

  const rawBefore = c.req.query("before");
  let before: number | undefined;
  if (rawBefore !== undefined) {
    before = Number(rawBefore);
    if (!/^[1-9][0-9]*$/.test(rawBefore) || !Number.isSafeInteger(before)) {
      return c.json({ ok: false, error: "invalid_before" }, 400);
    }
  }

  const page = await listPromptTraces({
    episodeId, ownerId, kind, limit,
    ...(shotId !== undefined ? { shotId } : {}),
    ...(before !== undefined ? { before } : {}),
  });
  const body: PromptTracesResponse = {
    ok: true,
    items: page.items.map(toPromptTraceView),
    next_before: page.next_before === null ? null : String(page.next_before),
    legacy: page.items.length === 0 && before === undefined
      ? legacyNote({ kind, ...(shotId !== undefined ? { shotId } : {}) }, loaded.episode)
      : null,
  };
  return c.json(body);
});

export default prompts;
