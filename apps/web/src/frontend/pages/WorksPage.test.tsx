import { expect, test } from "bun:test";
import type { Destination, Episode, Persona } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { filterWorks, WorksList } from "./WorksPage";

test("works lists every episode in newest first order with its own status and link", () => {
  const episodes = [
    { episode_id: "older", name: "旧期", persona_id: "p1", status: "done", created_at: "2026-01-01" },
    { episode_id: "newer", name: "新期", persona_id: "p1", status: "failed", created_at: "2026-02-01" },
  ] as Episode[];
  const html = renderToStaticMarkup(<StaticRouter location="/works"><WorksList episodes={episodes} personas={[]} /></StaticRouter>);
  expect(html.indexOf("新期")).toBeLessThan(html.indexOf("旧期"));
  expect(html).toContain('href="/episodes/newer"');
  expect(html).toContain('href="/episodes/older"');
  expect(html).toContain("失败");
  expect(html).toContain("已完成");
  expect(html).toContain('href="/help"');
});

test("works filters use real status and catalog metadata without guessing missing regions", () => {
  const episodes = [
    { episode_id: "cn", name: "黄山日记", persona_id: "p1", destination_id: "huangshan", status: "script_review", created_at: "2026-02-01" },
    { episode_id: "fr", name: "巴黎日记", persona_id: "p1", destination_id: "paris", status: "done", created_at: "2026-02-02" },
    { episode_id: "old", name: "旧作品", persona_id: "p1", destination_id: "legacy", status: "draft", created_at: "2026-02-03" },
  ] as Episode[];
  const personas = [{ persona_id: "p1", name: "阿晴" }] as Persona[];
  const destinations = [
    { destination_id: "huangshan", name: "黄山", city: "黄山市", country_code: "CN", province: "安徽", season_best: ["春"] },
    { destination_id: "paris", name: "巴黎", city: "巴黎", country_code: "FR", season_best: ["秋"] },
    { destination_id: "legacy", name: "老目的地", city: "旧城", season_best: [] },
  ] as Destination[];
  const ids = (query: string, status: "all" | "draft" | "active" | "done", region: "all" | "CN" | "overseas", province = "", season = "") =>
    filterWorks(episodes, personas, destinations, query, status, region, province, season).map((e) => e.episode_id);
  expect(ids("阿晴", "all", "all")).toEqual(["cn", "fr", "old"]);
  expect(ids("黄山", "active", "CN", "安徽", "春")).toEqual(["cn"]);
  expect(ids("", "done", "overseas")).toEqual(["fr"]);
  expect(ids("", "draft", "CN")).toEqual([]);
  expect(ids("", "draft", "all")).toEqual(["old"]);
});
