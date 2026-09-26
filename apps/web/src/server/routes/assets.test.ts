import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persona } from "@kelvoy/engine";
import { close, createSession, createUser, insertPersona, open } from "@kelvoy/store";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import assets, { resolveAssetPath } from "./assets";

function personaFixture(id: string, ownerId: string): Persona {
  return {
    persona_id: id,
    owner_id: ownerId,
    version: 1,
    name: "小岛",
    desc: "30 岁男性，短发",
    locked: ["脸型"],
    default_outfit: "浅灰亚麻衬衫",
    refs: [`persona/${id}/front.png`],
    style: { lut: "lut/warm_film.cube", title_style: "serif-center" },
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/api/assets", assets);
  return app;
}

async function login(username: string): Promise<{ cookie: string; ownerId: string }> {
  const created = await createUser({ username, password_hash: "hashed" });
  if (!created.ok) throw new Error("unexpected username collision in test");
  const session = await createSession(created.user.user_id);
  return { cookie: `kelvoy_session=${session.session_id}`, ownerId: created.user.user_id };
}

let tmpRoot: string;

async function writeAsset(relativeKey: string, contents: string): Promise<void> {
  const full = join(tmpRoot, "projects", relativeKey);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
}

beforeEach(async () => {
  open(":memory:");
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-assets-api-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
});

afterEach(async () => {
  close();
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

test("requires login", async () => {
  const app = buildApp();
  const res = await app.request("/api/assets/dest/lingshan/buddha_01.jpg");
  expect(res.status).toBe(401);
});

test("serves a destination landmark reference image", async () => {
  const { cookie } = await login("dannei");
  await writeAsset("dest/lingshan/buddha_01.jpg", "landmark-bytes");

  const app = buildApp();
  const res = await app.request("/api/assets/dest/lingshan/buddha_01.jpg", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("landmark-bytes");
});

test("serves the owner's own persona reference image", async () => {
  const { cookie, ownerId } = await login("dannei");
  await insertPersona(personaFixture("c_1", ownerId));
  await writeAsset("persona/c_1/front.png", "persona-bytes");

  const app = buildApp();
  const res = await app.request("/api/assets/persona/c_1/front.png", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("persona-bytes");
});

test("404s on someone else's persona reference image", async () => {
  const { cookie } = await login("dannei");
  await insertPersona(personaFixture("c_1", "u_someone_else"));
  await writeAsset("persona/c_1/front.png", "persona-bytes");

  const app = buildApp();
  const res = await app.request("/api/assets/persona/c_1/front.png", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("serves an official persona reference image to another account", async () => {
  const { cookie } = await login("official-reader");
  await insertPersona({ ...personaFixture("c_official", "u_other"), owner_id: null });
  await writeAsset("persona/c_official/front.png", "official-bytes");
  const res = await buildApp().request("/api/assets/persona/c_official/front.png", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("official-bytes");
});

test("encoded traversal from an official persona cannot read a private persona asset", async () => {
  const { cookie } = await login("traversal-reader");
  await insertPersona({ ...personaFixture("c_official", "u_other"), owner_id: null });
  await insertPersona(personaFixture("c_private", "u_other"));
  await writeAsset("persona/c_private/front.png", "private-bytes");
  const res = await buildApp().request(
    "/api/assets/persona/c_official/..%2F..%2Fpersona/c_private/front.png", { headers: { cookie } },
  );
  expect(res.status).toBe(400);
});

test("encoded traversal from a destination cannot read a private persona asset", async () => {
  const { cookie } = await login("dest-traversal-reader");
  await insertPersona(personaFixture("c_private", "u_other"));
  await writeAsset("persona/c_private/front.png", "private-bytes");
  const res = await buildApp().request(
    "/api/assets/dest/..%2Fpersona/c_private/front.png", { headers: { cookie } },
  );
  expect(res.status).toBe(400);
});

test("404s on a persona id that doesn't exist", async () => {
  const { cookie } = await login("dannei");
  await writeAsset("persona/c_missing/front.png", "persona-bytes");

  const app = buildApp();
  const res = await app.request("/api/assets/persona/c_missing/front.png", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("rejects a key outside the dest/ and persona/ prefixes", async () => {
  const { cookie } = await login("dannei");
  await writeAsset("e_1/kf/07_a.png", "episode-artifact");

  const app = buildApp();
  const res = await app.request("/api/assets/e_1/kf/07_a.png", { headers: { cookie } });
  expect(res.status).toBe(400);
});

test("404s on a missing file under an allowed prefix", async () => {
  const { cookie } = await login("dannei");
  const app = buildApp();
  const res = await app.request("/api/assets/dest/lingshan/nope.jpg", { headers: { cookie } });
  expect(res.status).toBe(404);
});

test("resolveAssetPath blocks traversal out of the projects root", () => {
  expect(resolveAssetPath("dest/../../etc/passwd")).toBeNull();
  expect(resolveAssetPath("persona/c_1/../../../etc/passwd")).toBeNull();
  expect(resolveAssetPath("/etc/passwd")).toBeNull();
  expect(resolveAssetPath("../projects/dest/x.jpg")).toBeNull();
  expect(resolveAssetPath(undefined)).toBeNull();
  expect(resolveAssetPath("dest/../persona/c_private/front.png")).toBeNull();
  expect(resolveAssetPath("persona/c_official/../../persona/c_private/front.png")).toBeNull();
});

test("resolveAssetPath keeps a legitimate key under the projects root", () => {
  const path = resolveAssetPath("dest/lingshan/buddha_01.jpg");
  expect(path).not.toBeNull();
  expect(path?.endsWith(join("projects", "dest", "lingshan", "buddha_01.jpg"))).toBe(true);
});
