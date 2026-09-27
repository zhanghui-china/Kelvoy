import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import HelpPage, { GuideJumpLink, focusGuideHash, reopenOnboarding } from "./HelpPage";
import { GUIDE_SECTIONS } from "../guide";
import { GuideTip } from "../GuideTip";

test("guide renders six anchored stages and links to live workspace routes", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/help"><HelpPage /></StaticRouter>);
  expect(GUIDE_SECTIONS).toHaveLength(6);
  for (const section of GUIDE_SECTIONS) {
    expect(html).toContain(`id="${section.id}"`);
    expect(html).toContain(`href="/help#${section.id}"`);
    expect(html).toContain(`href="${section.href}"`);
  }
  for (const path of ["/episodes/new", "/personas", "/destinations", "/templates", "/settings", "/works", "/usage", "/episodes"]) {
    expect(html).toContain(`href="${path}"`);
  }
  expect(html).toContain("9:16");
  expect(html).toContain("16:9");
  expect(html).toContain("1–3");
  expect(html).toContain("30 fps");
  expect(html).toContain("旧版作品沿用原有节拍切点");
  expect(html).toContain("旧版合成设置不提供字幕和转场开关");
  const clips = GUIDE_SECTIONS.find((section) => section.id === "clips")!;
  const compose = GUIDE_SECTIONS.find((section) => section.id === "compose")!;
  expect(clips.summary).not.toContain("1 秒");
  expect(clips.review).not.toContain("1 秒");
  expect(compose.review).toContain("新版作品还需检查字幕和转场");
  expect(compose.summary).not.toContain("字幕");
  expect(compose.steps[1]).toContain("如启用字幕则检查字幕");
  expect(html).toContain("首次报告坏镜");
  expect(html).toContain("不会自动发布");
  expect(html).toContain("重新显示新手引导");
  expect(html).toContain("新建一期会按目的地类型预选匹配的模板");
  expect(html).toContain("暂不支持 CSV/PDF 导出");
  expect(html).toContain("其他重生成可能消耗积分");
  expect(html).not.toContain("实际用量为准");
});

test("reopening onboarding patches the account setting to zero", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return { ok: true, json: async () => ({ ok: true, settings: { onboarding_dismissed_version: 0 } }) } as Response;
  }) as typeof fetch;
  let result: Awaited<ReturnType<typeof reopenOnboarding>>;
  try { result = await reopenOnboarding(); } finally { globalThis.fetch = originalFetch; }
  expect(result.ok).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("/api/me/settings");
  expect(requests[0].init.method).toBe("PATCH");
  expect(JSON.parse(String(requests[0].init.body))).toEqual({ onboarding_dismissed_version: 0 });
});


test("contextual tip targets the same stable guide anchor", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/episodes/new"><GuideTip section="keyframes">逐镜选图</GuideTip></StaticRouter>);
  expect(html).toContain("逐镜选图");
  expect(html).toContain('href="/help#keyframes"');
  expect(html).toContain("审核关键帧");
});

test("guide hash navigation scrolls and focuses a known section", () => {
  let scrolled = 0;
  let focused = 0;
  const element = { scrollIntoView: () => { scrolled += 1; }, focus: () => { focused += 1; } };
  const document = { getElementById: (id: string) => id === "keyframes" ? element : null };
  expect(focusGuideHash("#keyframes", document)).toBe(true);
  expect(scrolled).toBe(1);
  expect(focused).toBe(1);
  expect(focusGuideHash("#missing", document)).toBe(false);
  expect(focusGuideHash("#%ZZ", document)).toBe(false);
});


test("clicking the current table-of-contents link focuses it again", () => {
  let scrolled = 0;
  let focused = 0;
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id: string) => id === "clips" ? {
    scrollIntoView: () => { scrolled += 1; }, focus: () => { focused += 1; },
  } : null } as unknown as Document;
  try {
    const link = GuideJumpLink({ section: "clips", currentHash: "#clips", children: "审核片段" });
    expect(link.props.to).toBe("/help#clips");
    link.props.onClick({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
    expect(scrolled).toBe(1);
    expect(focused).toBe(1);
  } finally { globalThis.document = previousDocument; }
});


test("modified or non-primary TOC clicks do not move the current page", () => {
  let scrolled = 0;
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({
    scrollIntoView: () => { scrolled += 1; }, focus: () => {},
  }) } as unknown as Document;
  try {
    const link = GuideJumpLink({ section: "clips", currentHash: "#clips", children: "审核片段" });
    for (const override of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      link.props.onClick({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...override });
    }
    expect(scrolled).toBe(0);
  } finally { globalThis.document = previousDocument; }
});
