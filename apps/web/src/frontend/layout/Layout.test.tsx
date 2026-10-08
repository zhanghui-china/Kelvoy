import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import Layout, { workspaceTitle } from "./Layout";

test("shell exposes grouped real navigation and a specific nested-route title", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/personas/new"><Layout /></StaticRouter>);
  expect(html).toContain('aria-label="资源库"');
  expect(html).toContain('class="k-topbar-title">新建角色');
  expect(html).toContain('href="/usage"');
  expect(html).toContain('href="/help"');
  expect(html).not.toContain("99,999");
  expect(html).toContain('aria-label="收起侧栏"');
});

test("workspace titles distinguish creation, detail and edit routes", () => {
  expect(workspaceTitle("/episodes/new")).toBe("新建一期");
  expect(workspaceTitle("/episodes/ep-42")).toBe("作品详情");
  expect(workspaceTitle("/personas/p1/edit/")).toBe("编辑角色");
  expect(workspaceTitle("/destinations/drafts")).toBe("我的目的地草稿");
  expect(workspaceTitle("/destinations/drafts/draft-1")).toBe("编辑目的地草稿");
  expect(workspaceTitle("/usage/")).toBe("积分与用量");
});
