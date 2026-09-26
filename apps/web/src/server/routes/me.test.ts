import { close, createUser, getUserByUsername, grantCredits, open } from "@kelvoy/store";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import auth from "./auth";
import me from "./me";

// 同 auth.test.ts：账号是预置的，测试里直接调 store 建号，再走真实的
// /api/auth/login 拿 cookie——改密码这条路由的重点就是"必须是登录本人"，
// 绕过登录直接塞 ownerId 测不出这件事。
function buildApp() {
  const app = new Hono();
  app.route("/api/auth", auth);
  app.route("/api/me", me);
  return app;
}

async function seedUser(username: string, password: string): Promise<void> {
  const password_hash = await Bun.password.hash(password);
  await createUser({ username, password_hash });
}

async function loginCookie(app: Hono, username: string, password: string): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no set-cookie header in response");
  return setCookie.split(";")[0]!;
}

function send(app: Hono, method: string, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("credit balance and ledger belong only to the signed-in account", async () => {
  const app = buildApp();
  await seedUser("first", "hunter2");
  await seedUser("second", "hunter2");
  const first = await getUserByUsername("first");
  grantCredits(first!.user_id, 7, "grant-first");
  expect((await app.request("/api/me/credits")).status).toBe(401);
  const secondCookie = await loginCookie(app, "second", "hunter2");
  const second = await (await app.request("/api/me/credits", { headers: { cookie: secondCookie } })).json() as {
    balance: { available: number }; ledger: unknown[];
  };
  expect(second.balance.available).toBe(0);
  expect(second.ledger).toHaveLength(0);
  const firstCookie = await loginCookie(app, "first", "hunter2");
  const mine = await (await app.request("/api/me/credits", { headers: { cookie: firstCookie } })).json() as {
    balance: { available: number }; ledger: unknown[];
  };
  expect(mine.balance.available).toBe(7);
  expect(mine.ledger).toHaveLength(1);
});

describe("GET/PATCH /api/me/settings", () => {
  test("returns only the authenticated account identity for draft isolation", async () => {
    const app = buildApp();
    await seedUser("first", "hunter2");
    await seedUser("second", "hunter2");
    expect((await app.request("/api/me")).status).toBe(401);
    const firstCookie = await loginCookie(app, "first", "hunter2");
    const secondCookie = await loginCookie(app, "second", "hunter2");
    const first = await (await app.request("/api/me", { headers: { cookie: firstCookie } })).json() as { user: { user_id: string; username: string } };
    const second = await (await app.request("/api/me", { headers: { cookie: secondCookie } })).json() as { user: { user_id: string; username: string } };
    expect(first.user.username).toBe("first");
    expect(second.user.username).toBe("second");
    expect(first.user.user_id).not.toBe(second.user.user_id);
  });
  test("rejects grid as a newly saved default mode", async () => {
    const app = buildApp();
    await seedUser("grid-default", "hunter2");
    const cookie = await loginCookie(app, "grid-default", "hunter2");
    const res = await send(app, "PATCH", "/api/me/settings", { default_mode: "grid" }, cookie);
    expect(res.status).toBe(400);
  });
  test("refuses both without a session", async () => {
    const app = buildApp();
    expect((await app.request("/api/me/settings")).status).toBe(401);
    expect((await send(app, "PATCH", "/api/me/settings", { default_candidates: 3 })).status).toBe(401);
  });

  test("a never-configured account reads back an empty object", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");

    const res = await app.request("/api/me/settings", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, settings: {} });
  });

  test("patches merge instead of replacing", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");

    await send(app, "PATCH", "/api/me/settings", { default_tone: "松弛", default_mode: "per_shot" }, cookie);
    const res = await send(app, "PATCH", "/api/me/settings", { default_candidates: 3 }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: { default_tone: "松弛", default_mode: "per_shot", default_candidates: 3 },
    });
  });

  test("rejects a candidate count outside 1–3", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");

    const res = await send(app, "PATCH", "/api/me/settings", { default_candidates: 5 }, cookie);
    expect(res.status).toBe(400);
  });

  test("settings are per account, not shared", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    await seedUser("other", "hunter2");
    const mine = await loginCookie(app, "dannei", "hunter2");
    const theirs = await loginCookie(app, "other", "hunter2");

    await send(app, "PATCH", "/api/me/settings", { default_tone: "松弛" }, mine);
    const res = await app.request("/api/me/settings", { headers: { cookie: theirs } });
    expect(await res.json()).toEqual({ ok: true, settings: {} });
  });
});

describe("POST /api/me/password", () => {
  test("refuses without a session", async () => {
    const app = buildApp();
    const res = await send(app, "POST", "/api/me/password", {
      current_password: "hunter2",
      new_password: "hunter3",
    });
    expect(res.status).toBe(401);
  });

  test("refuses a wrong current password, leaving the old one working", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");

    const res = await send(
      app,
      "POST",
      "/api/me/password",
      { current_password: "wrong", new_password: "hunter3" },
      cookie,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_credentials" });
    await loginCookie(app, "dannei", "hunter2");
  });

  test("rejects a missing/empty new password", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");

    const res = await send(app, "POST", "/api/me/password", { current_password: "hunter2" }, cookie);
    expect(res.status).toBe(400);
  });

  test("changes the password: the new one logs in, the old one doesn't", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");

    const res = await send(
      app,
      "POST",
      "/api/me/password",
      { current_password: "hunter2", new_password: "hunter3" },
      cookie,
    );
    expect(res.status).toBe(200);

    await loginCookie(app, "dannei", "hunter3");
    const oldLogin = await send(app, "POST", "/api/auth/login", {
      username: "dannei",
      password: "hunter2",
    });
    expect(oldLogin.status).toBe(401);
  });

  test("changes only the caller's own account", async () => {
    const app = buildApp();
    await seedUser("dannei", "hunter2");
    await seedUser("other", "hunter2");
    const cookie = await loginCookie(app, "dannei", "hunter2");
    const otherBefore = await getUserByUsername("other");

    await send(
      app,
      "POST",
      "/api/me/password",
      { current_password: "hunter2", new_password: "hunter3" },
      cookie,
    );

    const otherAfter = await getUserByUsername("other");
    expect(otherAfter?.password_hash).toBe(otherBefore!.password_hash);
  });
});
