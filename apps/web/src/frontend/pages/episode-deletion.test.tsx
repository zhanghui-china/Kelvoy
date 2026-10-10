import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { episodeDeletion } from "./episode-deletion";
import { DeleteEpisodeDialog } from "./DeleteEpisodeButton";

test("confirmation names the work and describes permanent deletion and refunds", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/works"><DeleteEpisodeDialog
    name="黄山日记" pending={false} error={null} onCancel={() => {}} onConfirm={() => {}} />
  </StaticRouter>);
  expect(html).toContain("黄山日记");
  expect(html).toContain("删除后无法恢复，分享链接将失效。正在进行的任务会停止，未结算的预留积分将退回。");
  expect(html).toContain('aria-labelledby=');
  expect(html).toContain("确认删除");
});

test("deletion locks repeated submissions and only reports success after commit", async () => {
  let finish!: (result: { ok: true }) => void;
  let requests = 0;
  const events: unknown[] = [];
  const submit = episodeDeletion({ request: () => { requests++; return new Promise(resolve => { finish = resolve; }); },
    busy: value => events.push(value), error: value => events.push(value),
    success: () => events.push("deleted"), login: () => events.push("login"), missing: () => events.push("missing") });
  const first = submit();
  await submit();
  expect(requests).toBe(1);
  expect(events).not.toContain("deleted");
  finish({ ok: true });
  await first;
  expect(events).toEqual([true, null, "deleted", false]);
});

test("failed deletion preserves the work and allows retry; missing work shows return path", async () => {
  let result: { ok: false; error: string } | { ok: true } = { ok: false, error: "network_error" };
  const events: unknown[] = [];
  const submit = episodeDeletion({ request: async () => result, busy: () => {},
    error: value => events.push(value), success: () => events.push("deleted"),
    login: () => events.push("login"), missing: () => events.push("missing") });
  await submit();
  expect(events).toContain("删除失败，请重试。");
  expect(events).not.toContain("deleted");
  result = { ok: false, error: "not_found" };
  await submit();
  expect(events).toContain("missing");
  result = { ok: true };
  await submit();
  expect(events).toContain("deleted");
});
