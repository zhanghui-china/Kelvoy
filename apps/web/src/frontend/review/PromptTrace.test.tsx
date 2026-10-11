import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import PromptTrace from "./PromptTrace";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function spyFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    calls.push(String(url));
    return Response.json({ ok: true, items: [], next_before: null, legacy: null });
  }) as unknown as typeof fetch;
  return calls;
}

test("video disclosure is collapsed by default, names the shot and sends no request on mount", () => {
  const calls = spyFetch();
  const html = renderToStaticMarkup(<PromptTrace episodeId="ep1" kind="video" shotId="s1" shotNo={3} />);
  expect(html).toContain("<details");
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain("查看第 3 镜发给模型的提示词");
  expect(html).not.toContain("正在读取提示词");
  expect(calls.length).toBe(0);
});

test("script disclosure uses the script wording and stays collapsed without a request", () => {
  const calls = spyFetch();
  const html = renderToStaticMarkup(<PromptTrace episodeId="ep1" kind="script" refreshKey="a:3" />);
  expect(html).toContain("查看发给模型的脚本提示词");
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(calls.length).toBe(0);
});
