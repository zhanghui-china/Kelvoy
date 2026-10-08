import { expect, test } from "bun:test";
import type { ApiResult } from "../api/client";
import { personaDeletion } from "./persona-deletion";

test("named confirmation protects history and synchronous duplicate calls send one delete", async () => {
  let resolve!: (result: ApiResult<object>) => void;
  let requests = 0;
  const messages: string[] = [];
  const busy: boolean[] = [];
  const remove = personaDeletion({ name: "阿澄", confirm: message => { messages.push(message); return true; },
    request: () => { requests++; return new Promise(done => { resolve = done; }); },
    busy: value => busy.push(value), error: () => {}, refresh: message => messages.push(message), login: () => {},
  });
  const first = remove();
  await remove();
  expect(requests).toBe(1);
  expect(messages[0]).toContain("阿澄");
  expect(messages[0]).toContain("已有作品、历史版本及照片会保留");
  resolve({ ok: true });
  await first;
  expect(messages[1]).toBe("角色已删除。");
  expect(busy).toEqual([true, false]);
});

test("cancel sends nothing; errors permit retry and version conflict refreshes without retrying deletion", async () => {
  let confirmed = false;
  let requests = 0;
  const errors: (string | null)[] = [];
  const messages: string[] = [];
  const remove = personaDeletion({ name: "角色", confirm: () => confirmed,
    request: async () => { requests++; return { ok: false, error: requests === 1 ? "network_error" : "version_conflict" }; },
    busy: () => {}, error: message => errors.push(message), refresh: message => messages.push(message), login: () => {},
  });
  await remove(); expect(requests).toBe(0);
  confirmed = true;
  await remove(); expect(errors.at(-1)).toContain("重试");
  await remove(); expect(requests).toBe(2);
  expect(messages[0]).toContain("列表已刷新");
});

test("expired session redirects login", async () => {
  let logins = 0;
  const remove = personaDeletion({ name: "角色", confirm: () => true,
    request: async () => ({ ok: false, error: "unauthorized" }), busy: () => {}, error: () => {},
    refresh: () => { throw new Error("unexpected refresh"); }, login: () => { logins++; },
  });
  await remove(); expect(logins).toBe(1);
});
