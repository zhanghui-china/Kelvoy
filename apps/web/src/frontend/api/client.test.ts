import { afterEach, expect, test } from "bun:test";
import { getEstimate } from "./client";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function captureUrls(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (path: unknown) => {
    urls.push(String(path));
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return urls;
}

test("estimate defaults to the keyframe flow when video source is omitted", async () => {
  const urls = captureUrls();
  await getEstimate("per_shot", 3);
  expect(urls[0]).toContain("video_source=keyframe");
});

test("an explicit video source is sent unchanged", async () => {
  const urls = captureUrls();
  await getEstimate("per_shot", 3, "references");
  expect(urls[0]).toContain("video_source=references");
});
