import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountCard } from "./AccountSummary";

test("account card shows the authenticated name and formatted available credits", () => {
  const html = renderToStaticMarkup(<AccountCard username="huntun" available={100_968} />);
  expect(html).toContain("huntun");
  expect(html).toContain("100,968");
  expect(html).toContain("可用额度");
});

test("account card does not show a stale balance when loading fails", () => {
  const html = renderToStaticMarkup(<AccountCard username="huntun" available={100_968} error="network_error" />);
  expect(html).toContain("余额暂不可用");
  expect(html).not.toContain("100,968");
});
