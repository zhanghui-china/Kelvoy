import { close, createUser, open } from "@kelvoy/store";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";
import auth from "./auth";

function buildApp() {
  const app = new Hono();
  app.route("/api/auth", auth);
  app.get("/api/protected", requireOwner, (c) => c.json({ ok: true, owner_id: c.get("ownerId") }));
  return app;
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no set-cookie header in response");
  return setCookie.split(";")[0]!;
}

async function postJson(app: Hono, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

// 比赛 demo 阶段账号是预置的（packages/cli create-user），不走 HTTP 注册，
// 测试里直接调 store 建号。
async function seedUser(username: string, password: string): Promise<void> {
  const password_hash = await Bun.password.hash(password);
  await createUser({ username, password_hash });
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

describe("POST /api/auth/login", () => {
  test("rejects wrong credentials", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const res = await postJson(app, "/api/auth/login", { username: "dannei", password: "wrong" });
    expect(res.status).toBe(401);
  });

  test("rejects an unknown username", async () => {
    const app = buildApp();
    const res = await postJson(app, "/api/auth/login", { username: "ghost", password: "whatever" });
    expect(res.status).toBe(401);
  });

  test("logs in with correct credentials and sets a fresh session cookie", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const res = await postJson(app, "/api/auth/login", { username: "dannei", password: "hunter2" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("kelvoy_session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });
});

describe("full flow: login -> access protected route -> logout -> access is refused", () => {
  test("cookie grants access to requireOwner routes until logout", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const loginRes = await postJson(app, "/api/auth/login", { username: "dannei", password: "hunter2" });
    const cookie = sessionCookie(loginRes);

    const protectedRes = await app.request("/api/protected", { headers: { cookie } });
    expect(protectedRes.status).toBe(200);
    const protectedBody = (await protectedRes.json()) as { owner_id: string };
    expect(protectedBody.owner_id).toBeTruthy();

    const logoutRes = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(logoutRes.status).toBe(200);

    const afterLogout = await app.request("/api/protected", { headers: { cookie } });
    expect(afterLogout.status).toBe(401);
  });

  test("requireOwner refuses a request with no cookie at all", async () => {
    const app = buildApp();
    const res = await app.request("/api/protected");
    expect(res.status).toBe(401);
  });
});
