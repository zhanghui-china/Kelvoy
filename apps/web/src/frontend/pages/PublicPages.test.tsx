import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import LoginPage from "./LoginPage";
import SharePage from "./SharePage";

const render = (node: React.ReactNode) => renderToStaticMarkup(<StaticRouter location="/s/demo">{node}</StaticRouter>);

test("public share displays loading feedback before its anonymous request resolves", () => {
  const html = render(<SharePage />);
  expect(html).toContain('role="status"');
  expect(html).toContain("加载中");
  expect(html).not.toContain("k-auth-shell");
});

test("login supports password managers and retains its native submit form", () => {
  const html = render(<LoginPage />);
  expect(html).toContain('autoComplete="username"');
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('type="submit"');
  expect(html).not.toContain('href="/register"');
});
