import { afterEach, expect, test } from "bun:test";
import type { DestinationDraft } from "@kelvoy/engine";
import { deleteDestinationDraft, destinationDraftAssetUrl, publishDestinationDraft, removeDestinationPhoto, saveDestinationDraft, uploadDestinationPhotos } from "./destination-drafts";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const draft: DestinationDraft = { draft_id: "draft id", creator_id: "u", edit_version: 4, destination_id: null, base_version: null, published_version: null, content: { name: "山", city: "城", type: "scenic_area", landmarks: [], season_best: [], route: [], food: [], transport: "", stay: "" } };
test("draft writes carry latest edit revision and encode URL segments", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input, init) => { calls.push({ url: String(input), init }); return Response.json({ ok: true, draft }); }) as typeof fetch;
  await saveDestinationDraft(draft, draft.content);
  await publishDestinationDraft(draft);
  await deleteDestinationDraft(draft);
  await removeDestinationPhoto(draft, "land mark", "dest/id/photo.webp");
  expect(calls.every(call => call.url.startsWith("/api/destination-drafts/draft%20id"))).toBe(true);
  expect(calls.map(call => JSON.parse(String(call.init?.body)).edit_version)).toEqual([4, 4, 4, 4]);
  expect(calls[3].url).toContain("landmarks/land%20mark/photos");
  expect(destinationDraftAssetUrl("draft id", "dest/id/photo name.webp")).toBe("/api/destination-drafts/draft%20id/assets/dest/id/photo%20name.webp");
});
test("batch upload lets browser set multipart boundary and preserves conflict", async () => {
  let sent: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => { sent = init; return Response.json({ ok: false, error: "conflict" }, { status: 409 }); }) as typeof fetch;
  const result = await uploadDestinationPhotos(draft, "a", [new File(["image"], "one.png", { type: "image/png" }), new File(["image"], "two.png", { type: "image/png" })]);
  expect(sent?.headers).toBeUndefined();
  const form = sent?.body as FormData;
  expect(form.get("edit_version")).toBe("4");
  expect(form.getAll("files")).toHaveLength(2);
  expect(result).toEqual({ ok: false, error: "conflict" });
});
