import { close, createSession, createUser, open, upsertTemplate } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Template } from "@kelvoy/engine";
import { Hono } from "hono";
import templates from "./templates";

function fixture(id: string, ownerId: string | null): Template {
  return {
    template_id: id,
    owner_id: ownerId,
    name: `模板 ${id}`,
    skeleton: "scenic_area",
    lut: "lut/warm_film.cube",
    intro: null,
    outro: null,
    title_style: "serif-center",
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/templates", templates);
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
  const res = await app.request("/api/templates");
  expect(res.status).toBe(401);
});

test("returns official templates plus the logged-in user's own", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertTemplate(fixture("t_official", null));
  await upsertTemplate(fixture("t_mine", ownerId));
  await upsertTemplate(fixture("t_someone_elses", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/templates", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; templates: Template[] };
  expect(body.templates.map((t) => t.template_id).sort()).toEqual(["t_mine", "t_official"]);
});

function validCreateBody() {
  return {
    name: "新模板",
    skeleton: "scenic_area",
    lut: "lut/warm_film.cube",
    intro: null,
    outro: null,
    title_style: "serif-center",
  };
}

test("POST / requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/templates", {
    method: "POST",
    body: JSON.stringify(validCreateBody()),
  });
  expect(res.status).toBe(401);
});

test("POST / creates a private template owned by the caller", async () => {
  const { cookie, ownerId } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/templates", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(validCreateBody()),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok: boolean; template: Template };
  expect(body.template.owner_id).toBe(ownerId);
  expect(body.template.name).toBe("新模板");

  const listRes = await app.request("/api/templates", { headers: { cookie } });
  const listBody = (await listRes.json()) as { templates: Template[] };
  expect(listBody.templates.map((t) => t.template_id)).toContain(body.template.template_id);
});

test("POST / rejects an invalid body", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/templates", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...validCreateBody(), skeleton: "beach" }),
  });
  expect(res.status).toBe(400);
});

test("DELETE /:id requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/templates/t_1", { method: "DELETE" });
  expect(res.status).toBe(401);
});

test("DELETE /:id deletes the caller's own private template", async () => {
  const { cookie, ownerId } = await login("dannei");
  await upsertTemplate(fixture("t_mine", ownerId));

  const app = buildApp();
  const res = await app.request("/api/templates/t_mine", { method: "DELETE", headers: { cookie } });
  expect(res.status).toBe(200);

  const listRes = await app.request("/api/templates", { headers: { cookie } });
  const listBody = (await listRes.json()) as { templates: Template[] };
  expect(listBody.templates.map((t) => t.template_id)).not.toContain("t_mine");
});

test("DELETE /:id 404s on an official template", async () => {
  const { cookie } = await login("dannei");
  await upsertTemplate(fixture("t_official", null));

  const app = buildApp();
  const res = await app.request("/api/templates/t_official", { method: "DELETE", headers: { cookie } });
  expect(res.status).toBe(404);
});

test("DELETE /:id 404s on someone else's private template", async () => {
  const { cookie } = await login("dannei");
  await upsertTemplate(fixture("t_someone_elses", "u_someone_else"));

  const app = buildApp();
  const res = await app.request("/api/templates/t_someone_elses", {
    method: "DELETE",
    headers: { cookie },
  });
  expect(res.status).toBe(404);
});
