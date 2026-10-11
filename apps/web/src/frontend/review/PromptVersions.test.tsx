import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PromptTraceItem } from "../../shared/prompt-traces";
import { PromptVersions } from "./PromptVersions";
import type { PromptTraceState } from "./prompt-trace-controller";

function item(over: Partial<PromptTraceItem> & { id: string }): PromptTraceItem {
  return {
    kind: "h3_rewrite", shot_id: "s1", round: null, attempt: 1, source: "llm", outcome: "ok",
    validated: true, rule: null, model: null, skill_version: null, writer_version: null, h3_mode: null,
    user_message: `user ${over.id}`, correction_message: null, final_prompt: `final ${over.id}`, rejected_output: null,
    input_hash: null, truncated: false, created_at: "2026-10-11T08:00:00Z", ...over,
  };
}
const ready = (items: PromptTraceItem[], extra: Partial<Extract<PromptTraceState, { status: "ready" }>> = {}): PromptTraceState => ({
  status: "ready", items, nextBefore: null, legacy: null, loadingMore: false, moreFailed: false, ...extra,
});
const noop = () => {};
function render(state: PromptTraceState, kind: "script" | "video" = "video", fallbackPrompt: string | null = null) {
  return renderToStaticMarkup(
    <PromptVersions kind={kind} state={state} fallbackPrompt={fallbackPrompt} onRetry={noop} onLoadMore={noop} />,
  );
}

test("loading shows a polite status", () => {
  const html = render({ status: "loading" });
  expect(html).toContain('role="status"');
  expect(html).toContain("正在读取提示词…");
});

test("empty without legacy explains the records predate the feature", () => {
  expect(render({ status: "empty", legacy: null })).toContain("此作品生成于提示词记录上线之前，没有保留当时的提示词");
  expect(render({ status: "empty", legacy: { note: "not_retained" } })).toContain("没有保留当时的提示词");
});

test("legacy final_only renders a history block with the final prompt, English-tagged", () => {
  const html = render({ status: "empty", legacy: { note: "final_only", final_prompt: "A slow pan over the lake" } });
  expect(html).toContain("历史记录（仅保留最终提示词）");
  expect(html).toContain("A slow pan over the lake");
  expect(html).toContain('lang="en"');
});

test("fallback prompt is used only when there is no legacy, and never duplicated", () => {
  const withFallback = render({ status: "empty", legacy: null }, "video", "FALLBACK TEXT");
  expect(withFallback).toContain("历史记录（仅保留最终提示词）");
  expect(withFallback.split("FALLBACK TEXT").length - 1).toBe(1);
  const both = render({ status: "empty", legacy: { note: "final_only", final_prompt: "LEGACY TEXT" } }, "video", "FALLBACK TEXT");
  expect(both).toContain("LEGACY TEXT");
  expect(both).not.toContain("FALLBACK TEXT");
});

test("error is an alert with a retry button and no server detail", () => {
  const html = render({ status: "error" });
  expect(html).toContain('role="alert"');
  expect(html).toContain("重试");
  expect(html).toContain("<button");
});

test("newest version is expanded, older ones collapsed", () => {
  const html = render(ready([item({ id: "3" }), item({ id: "2" }), item({ id: "1" })]));
  const details = html.match(/<details[^>]*>/g) ?? [];
  expect(details.length).toBe(3);
  expect(details[0]).toContain("open");
  expect(details[1]).not.toContain("open");
  expect(details[2]).not.toContain("open");
  expect(html).toContain("第 1 版");
  expect(html).toContain("第 3 版");
  expect(html.indexOf("user 3")).toBeLessThan(html.indexOf("user 2"));
});

test("version labels cover source, validation result and rule", () => {
  const html = render(ready([
    item({ id: "2", source: "cache" }),
    item({ id: "1", validated: false, rule: "prompt_format_invalid" }),
  ]));
  expect(html).toContain("命中缓存，沿用此前改写结果");
  expect(html).toContain("模型生成");
  expect(html).toContain("通过");
  expect(html).toContain("未通过校验");
  expect(html).toContain("prompt_format_invalid");
});

test("blocks are labelled, optional blocks are omitted, truncated is flagged", () => {
  const plain = render(ready([item({ id: "1", final_prompt: null })]));
  expect(plain).toContain("发给模型的消息");
  expect(plain).not.toContain("格式纠正消息");
  expect(plain).not.toContain("最终发给视频模型的提示词");
  const full = render(ready([item({ id: "1", correction_message: "fix it", truncated: true })]));
  expect(full).toContain("格式纠正消息");
  expect(full).toContain("fix it");
  expect(full).toContain("最终发给视频模型的提示词");
  expect(full).toContain("内容过长，已截断");
  expect(plain).not.toContain("内容过长，已截断");
});

test("a rejected model output gets its own block, only when present", () => {
  const none = render(ready([item({ id: "1" })]));
  expect(none).not.toContain("被校验拒绝的模型输出");
  const html = render(ready([item({ id: "1", final_prompt: null, validated: false, rejected_output: "raw rejected text" })]));
  expect(html).toContain("被校验拒绝的模型输出");
  expect(html).toContain("raw rejected text");
  expect(html).toContain('aria-label="复制第 1 版 被校验拒绝的模型输出"');
});

test("copy buttons carry version and block name, text is a readonly selectable control", () => {
  const html = render(ready([item({ id: "1" })]));
  expect(html).toContain('aria-label="复制第 1 版 发给模型的消息"');
  expect(html).toContain("<textarea");
  expect(html).toContain('readonly=""');
  expect(html).toContain('aria-live="polite"');
});

test("script versions show round and generate/revision wording and group by run", () => {
  const html = render(ready([
    item({ id: "3", kind: "script_revision", shot_id: null, round: 1, attempt: 2 }),
    item({ id: "2", kind: "script_generate", shot_id: null, round: 2, attempt: 1 }),
    item({ id: "1", kind: "script_generate", shot_id: null, round: 1, attempt: 1 }),
  ]), "script");
  expect(html).toContain("优化");
  expect(html).toContain("生成");
  expect(html).toContain("第 2 轮");
  expect(html).toContain("第 1 轮");
  expect(html).toContain("第 2 次执行");
  expect(html).toContain("第 1 次执行");
});

test("load more appears only with a cursor and reflects progress and failure", () => {
  expect(render(ready([item({ id: "1" })]))).not.toContain("加载更早版本");
  const more = render(ready([item({ id: "2" })], { nextBefore: "2" }));
  expect(more).toContain("加载更早版本");
  expect(more).not.toContain('disabled=""');
  const loading = render(ready([item({ id: "2" })], { nextBefore: "2", loadingMore: true }));
  expect(loading).toContain('disabled=""');
  expect(loading).toContain("正在加载");
  expect(render(ready([item({ id: "2" })], { nextBefore: "2", moreFailed: true }))).toContain("加载更早版本失败");
});

test("prompt text is rendered as escaped text, never markup", () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(2)>`;
  const html = render(ready([item({ id: "1", user_message: evil, correction_message: evil, final_prompt: evil })]));
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  const legacy = render({ status: "empty", legacy: { note: "final_only", final_prompt: evil } });
  expect(legacy).not.toContain("<script>");
});
