import { afterEach, expect, test } from "bun:test";
import { insertStoryboardShot, patchStoryboardShot, requestStoryboardSuggestion, getStoryboardSuggestion } from "../api/client";
import { emptyShot, fillMissingSuggestion } from "./storyboard-model";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("empty manual insert sends stable anchor and fresh version; conflict never replays", async () => {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: false, error: "version_conflict", current_row_version: 9 });
  }) as typeof fetch;
  const draft = emptyShot("");
  const result = await insertStoryboardShot("episode/1", 8, "stable-3", draft);
  expect(result.ok).toBe(false);
  expect(calls).toEqual([{ url: "/api/episodes/episode%2F1/storyboard", body: { row_version: 8, after_shot_id: "stable-3", shot: draft } }]);
  expect(draft.beat).toBe("");
});

test("caption editing sends only caption without invalidating the visual draft", async () => {
  let request: unknown;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    request = JSON.parse(String(init?.body));
    return Response.json({ ok: true, row_version: 13 });
  }) as typeof fetch;
  await patchStoryboardShot("e", "stable-id", 12, { caption: "新字幕" });
  expect(request).toEqual({ row_version: 12, patch: { caption: "新字幕" } });
});

test("queued suggestion cannot insert itself and preserves user edits before confirmation", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    urls.push(String(url));
    return Response.json(urls.length === 1 ? { ok: true, task_id: "t", row_version: 2 } :
      { ok: true, status: "done", suggestion: { beat: "AI动作", caption: "AI字幕", kf_prompt: "AI画面" } });
  }) as typeof fetch;
  const queued = await requestStoryboardSuggestion("e", 1, null, "海边散步", emptyShot("scene"));
  expect(queued.ok).toBe(true);
  const result = await getStoryboardSuggestion("e", "t");
  if (!result.ok) throw new Error("expected completed result");
  const current = { ...emptyShot("scene"), beat: "我的动作" };
  const suggested = fillMissingSuggestion(current, result.suggestion ?? {}, new Set(["kf_prompt"]));
  expect(suggested.beat).toBe("我的动作");
  expect(suggested.caption).toBe("AI字幕");
  expect(suggested.kf_prompt).toBe("");
  expect(urls).toEqual(["/api/episodes/e/storyboard/suggestions", "/api/episodes/e/storyboard/suggestions/t"]);
});
