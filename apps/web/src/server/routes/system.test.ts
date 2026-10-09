import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, createSession, createUser, getSystemConfig, getDb, open } from "@kelvoy/store";
import { Hono } from "hono";
import { createSystemRoutes } from "./system";

let cookie: string;
let operatorCookie: string;
let calls: string[];
let backend: (url: string) => Response | Promise<Response>;
let app: Hono;
const env = { ...process.env };
const candidate = { version: 1, comfyui_base_url: "http://gpu:8188", bridge_base_url: null };
const report = { checked_at: "2026-10-09T00:00:00Z", checks: [
  { service: "comfyui", status: "healthy", interface_ready: true, duration_ms: 2, address: "http://gpu:8188", queue: {running:0,pending:0}, dependencies: [] },
  { service: "bridge", status: "error", duration_ms: 2, address: "http://gpu:5099", reason: "backend disconnected" },
] };
function request(method: string, path: string, body?: unknown, auth = operatorCookie) {
  return app.request(`/api/system/${path}`, { method, headers: { cookie: auth, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(async () => {
  open(":memory:");
  const user = await createUser({ username: "normal", password_hash: "unused" });
  const operator = await createUser({ username: "operator", password_hash: "unused" });
  if (!user.ok || !operator.ok) throw new Error("seed failed");
  cookie = `kelvoy_session=${(await createSession(user.user.user_id)).session_id}`;
  operatorCookie = `kelvoy_session=${(await createSession(operator.user.user_id)).session_id}`;
  process.env.KELVOY_OPERATOR_USER_IDS = operator.user.user_id;
  process.env.KELVOY_BACKEND_ALLOWED_ORIGINS = "http://gpu:8188,http://gpu:5099,http://127.0.0.1:8188,http://127.0.0.1:5099";
  calls = [];
  backend = (url) => Response.json(url.endsWith("/health") ? { status: "ok" } : report);
  app = new Hono().route("/api/system", createSystemRoutes(async (input) => {
    const url = String(input); calls.push(url); return backend(url);
  }));
});
afterEach(() => { close(); process.env = { ...env }; });

test("unauthenticated requests cannot read, test, or save", async () => {
  for (const [method,path,body] of [["GET","config",undefined],["POST","test",{}],["PATCH","config",candidate]] as const)
    expect((await request(method,path,body,"")).status).toBe(401);
  expect(calls).toHaveLength(0);
});
test("ordinary user sees simplified checks, cannot submit candidates or save", async () => {
  const config = await (await request("GET","config",undefined,cookie)).json();
  expect(config).toEqual({ok:true,operator:false});
  expect((await request("PATCH","config",candidate,cookie)).status).toBe(403);
  expect((await request("POST","test",candidate,cookie)).status).toBe(403);
  const result = await (await request("POST","test",{},cookie)).json();
  expect(result.checks).toHaveLength(4);
  const text = JSON.stringify(result);
  expect(text).not.toContain("http://"); expect(text).not.toContain("dependencies");
  expect(text).not.toContain("disconnected");
});
test("empty operator allowlist grants no configuration rights", async () => {
  process.env.KELVOY_OPERATOR_USER_IDS = "";
  expect((await request("PATCH","config",candidate)).status).toBe(403);
});
test("candidate testing leaves persisted configuration untouched; saving and clearing increment versions", async () => {
  const tested = await request("POST","test",candidate);
  expect(tested.status).toBe(200);
  expect((await getSystemConfig()).comfyui_base_url).toBeNull();
  const saved = await request("PATCH","config",candidate);
  expect(saved.status).toBe(200);
  expect((await getSystemConfig()).comfyui_base_url).toBe("http://gpu:8188");
  expect((await request("PATCH","config",candidate)).status).toBe(409);
  expect((await request("PATCH","config",{version:2,comfyui_base_url:null,bridge_base_url:null})).status).toBe(200);
  expect((await getSystemConfig()).comfyui_base_url).toBeNull();
});
test("rejects unapproved origins and malformed URLs before any network request", async () => {
  for (const url of ["file:///tmp/a","http://user:pass@gpu:8188","http://gpu:8188?q=1","http://gpu:8188#x","http://evil:8188","http://gpu:8188/?","http://gpu:8188/#","http://gpu:8188\\evil","http://gpu:8188/%2e%2e/evil"])
    expect((await request("POST","test",{...candidate,comfyui_base_url:url})).status).toBe(400);
  expect(calls).toHaveLength(0);
});
test("save revalidates interfaces; dependency failure and disconnected bridge alone do not block saving", async () => {
  backend = () => Response.json({ ...report, checks: [{ ...report.checks[0], status:"error", reason:"missing models", dependencies:[{workflow:"image",status:"error",missing_nodes:[],missing_models:["missing.safetensors"]}] },report.checks[1]] });
  expect((await request("PATCH","config",candidate)).status).toBe(200);
  backend = () => Response.json({ ...report, checks: [{ ...report.checks[0], interface_ready:false,status:"error" },report.checks[1]] });
  expect((await request("PATCH","config",{...candidate,version:2})).status).toBe(422);
});
test("malformed 200 and HTTP errors produce partial unchecked results", async () => {
  backend = (url) => url.endsWith("/health") ? Response.json({status:"bad"}) : Response.json({checks:[]});
  const result = await (await request("POST","test",{})).json();
  expect(result.checks.find((c: {service:string})=>c.service==="inference").status).toBe("error");
  expect(result.checks.find((c: {service:string})=>c.service==="comfyui").status).toBe("unchecked");
  backend = () => new Response("bad",{status:500});
  expect((await request("PATCH","config",candidate)).status).toBe(502);
});
test("overlapping tests coalesce read-only calls", async () => {
  backend = async (url) => { await Bun.sleep(15); return Response.json(url.endsWith("/health")?{status:"ok"}:report); };
  const responses = await Promise.all([request("POST","test",candidate),request("POST","test",candidate)]);
  expect(responses.map(r=>r.status)).toEqual([200,200]);
  expect(calls).toHaveLength(2);
  expect(calls.every(url=>url.endsWith("/health") || url.endsWith("/system/diagnostics"))).toBe(true);
});


test("task admitted during probe blocks save atomically; failed save leaves version intact", async () => {
  backend = (url) => {
    if (url.endsWith("/system/diagnostics")) getDb().query("insert into tasks(task_id,episode_id,stage,status) values('race','e_other','video','pending')").run();
    return Response.json(url.endsWith("/health") ? {status:"ok"} : report);
  };
  const res = await request("PATCH","config",candidate);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ok:false,error:"tasks_active"});
  expect((await getSystemConfig()).version).toBe(1);
});
test("invalid current deployment still produces simplified results and no target requests", async () => {
  process.env.KELVOY_BACKEND_ALLOWED_ORIGINS = "";
  // Inference validates inherited targets, which Web cannot infer from its own environment.
  backend = (url) => url.endsWith("/health") ? Response.json({status:"ok"}) : Response.json({detail:"origin not allowed"},{status:422});
  const response = await request("POST","test",{},cookie);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.checks.find((check:{service:string})=>check.service==="comfyui").status).toBe("unchecked");
  expect(JSON.stringify(body)).not.toContain("origin not allowed");
});
test("network failures are reported without leaking internal error URLs to ordinary users", async () => {
  backend = () => { throw new Error("private http://secret-host:8100"); };
  const result = await (await request("POST","test",{},cookie)).json();
  expect(result.checks.find((check:{service:string})=>check.service==="inference").status).toBe("error");
  expect(JSON.stringify(result)).not.toContain("secret-host");
});
