import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { GuideTip } from "../GuideTip";
import HelpPage, { focusGuideHash } from "./HelpPage";
import LandingHero from "./LandingHero";
import LandingHow from "./LandingHow";
import LoginPage from "./LoginPage";
import CreditPanel from "./CreditPanel";
import { ShareVideo } from "./SharePage";
import type { SharedEpisode } from "../api/client";
import { GUIDE_SECTIONS } from "../guide";

const render = (node: React.ReactNode) => renderToStaticMarkup(<StaticRouter location="/">{node}</StaticRouter>);

test("public entry copy explains both formats, variable candidates and workflow", () => {
  const html = render(<><LandingHero /><LandingHow /><LoginPage /></>);
  expect(html).toContain("9:16");
  expect(html).toContain("16:9");
  expect(html).toContain("从每镜 1–3 张候选图中选一张关键帧");
  expect(html).not.toContain("三选一");
  expect(html).toContain("脚本、关键帧、片段");
});

test("resource hints lead to focused, stable help sections", () => {
  const html = render(<><GuideTip section="personas">角色参考图</GuideTip><HelpPage /></>);
  expect(html).toContain('href="/help#personas"');
  for (const id of ["personas", "destinations", "templates", "credits", "settings"]) {
    expect(html).toContain(`id="${id}"`);
    let scrolled = false;
    let focused = false;
    expect(focusGuideHash(`#${id}`, { getElementById: (found) => found === id ? {
      scrollIntoView: () => { scrolled = true; }, focus: () => { focused = true; },
    } : null })).toBe(true);
    expect(scrolled && focused).toBe(true);
  }
});

test("credit summary distinguishes spendable, reserved, and recorded transactions", () => {
  const html = render(<CreditPanel />);
  expect(html).toContain("可用积分可用于新任务");
  expect(html).toContain("预留积分已锁定待结算");
  expect(html).toContain("实际记账流水");
});

test("share player uses recorded portrait and landscape dimensions", () => {
  const episode = { episode_id: "e1", render: { title: "旅行" }, final: { width: 1080, height: 1920 } } as SharedEpisode;
  const portrait = render(<ShareVideo slug="public" episode={episode} />);
  expect(portrait).toContain("aspect-ratio:1080/1920");
  const landscape = render(<ShareVideo slug="public" episode={{ ...episode, final: { ...episode.final!, width: 1920, height: 1080 } }} />);
  expect(landscape).toContain("aspect-ratio:1920/1080");
});

test("help describes pre-submit credits as estimates", () => {
  const html = render(<HelpPage />);
  expect(html).toContain("预估积分");
  expect(html).not.toContain("实际报价");
  expect(html).not.toContain("本期报价");
  expect(GUIDE_SECTIONS[0].steps.join(" ")).not.toContain("实际积分报价");
});
