import { getSystemConfig, saveSystemConfig } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";
import { isOperator, parseBackendValues } from "../system-config";
import { diagnosticRunner, simplifyReport, type DiagnosticFetch } from "../system-diagnostics";

export function createSystemRoutes(fetcher: DiagnosticFetch = (url,init)=>fetch(url,init)) {
  const system = new Hono();
  const diagnose = diagnosticRunner(fetcher);
  system.use("*",requireOwner);
  system.get("/config", async c => {
    const operator = isOperator(c.get("ownerId"));
    if (!operator) return c.json({ok:true,operator});
    return c.json({ok:true,operator,config:await getSystemConfig()});
  });
  system.post("/test", async c => {
    const operator = isOperator(c.get("ownerId"));
    const body: unknown = await c.req.json().catch(()=>null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ok:false,error:"invalid_config"},400);
    const candidate = Object.keys(body).length > 0;
    if (candidate && !operator) return c.json({ok:false,error:"forbidden"},403);
    const values = candidate ? parseBackendValues(body) : await getSystemConfigValues();
    if (!values) return c.json({ok:false,error:"invalid_config"},400);
    const result = await diagnose({comfyui_base_url:values.comfyui_base_url,bridge_base_url:values.bridge_base_url});
    const report = operator ? { ...result, checks:result.checks.map(check=>check.service === "web" ? {...check,address:new URL(c.req.url).origin} : check) } : simplifyReport(result);
    return c.json({ok:true,...report});
  });
  system.patch("/config", async c => {
    const actor = c.get("ownerId");
    if (!isOperator(actor)) return c.json({ok:false,error:"forbidden"},403);
    const values = parseBackendValues(await c.req.json().catch(()=>null),true);
    if (!values) return c.json({ok:false,error:"invalid_config"},400);
    // Version checked again in the commit transaction, after the asynchronous probe.
    if ((await getSystemConfig()).version !== values.version) return c.json({ok:false,error:"version_conflict"},409);
    const {version,...backends} = values;
    const result = await diagnose(backends);
    const comfy = result.checks.find(check=>check.service === "comfyui");
    if (!comfy || comfy.status === "unchecked") return c.json({ok:false,error:"diagnostics_failed"},502);
    if (comfy.interface_ready !== true) return c.json({ok:false,error:"backend_unreachable"},422);
    const saved = await saveSystemConfig(version!,backends,actor);
    if (!saved.ok) return c.json(saved,409);
    return c.json(saved);
  });
  return system;
}
async function getSystemConfigValues() {
  const {comfyui_base_url,bridge_base_url} = await getSystemConfig();
  return {comfyui_base_url,bridge_base_url};
}
export default createSystemRoutes();
