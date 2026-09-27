import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { WorksList } from "./WorksPage";

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
