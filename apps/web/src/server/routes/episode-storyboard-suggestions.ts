import { Hono } from "hono";
import { getStoryboardSuggestion, submitStoryboardSuggestion } from "@kelvoy/store";
const suggestions = new Hono();
suggestions.post("/:id/storyboard/suggestions", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ ok: false, error: "invalid_request" }, 400);
  const request = body as Record<string, unknown>;
  if (!Number.isSafeInteger(request.row_version) || (request.row_version as number) < 1) {
    return c.json({ ok: false, error: "invalid_row_version" }, 400);
  }
  const result = submitStoryboardSuggestion({ episode_id: c.req.param("id"), owner_id: c.get("ownerId"),
    row_version: request.row_version as number, request });
  if (!result.ok) return c.json(result, result.error === "not_found" ? 404 :
    result.error === "version_conflict" || result.error === "action_pending" ? 409 :
    result.error === "insufficient_credits" ? 402 : 400);
  return c.json(result);
});
suggestions.get("/:id/storyboard/suggestions/:taskId", (c) => {
  const result = getStoryboardSuggestion(c.req.param("id"), c.get("ownerId"), c.req.param("taskId"));
  if (!result) return c.json({ ok: false, error: "not_found" }, 404);
  return c.json(result);
});
export default suggestions;
