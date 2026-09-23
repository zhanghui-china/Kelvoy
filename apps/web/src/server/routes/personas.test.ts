import { close, createSession, createUser, insertPersona, open } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Persona } from "@kelvoy/engine";
import { Hono } from "hono";
import personas from "./personas";

function fixture(id: string, ownerId: string): Persona {
  return {
    persona_id: id,
    owner_id: ownerId,
    version: 1,
    name: "小岛",
    desc: "30 岁男性，短发",
    locked: ["脸型", "发型", "体态"],
    default_outfit: "浅灰亚麻衬衫",
    refs: ["persona/front.png", "persona/side.png", "persona/full.png"],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/personas", personas);
  return app;
}

async function login(username: string): Promise<{ cookie: string; ownerId: string }> {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("unexpected username collision in test");
  const session = await createSession(created.user.user_id);
  return { cookie: `kelvoy_session=${session.session_id}`, ownerId: created.user.user_id };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/personas");
  expect(res.status).toBe(401);
});

test("only returns the logged-in user's own personas", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(fixture("c_mine", ownerId));
  await insertPersona(fixture("c_someone_elses", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/personas", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; personas: Persona[] };
  expect(body.personas.map((p) => p.persona_id)).toEqual(["c_mine"]);
});
