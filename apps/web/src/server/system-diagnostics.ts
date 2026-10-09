import { parseBackendValues, type BackendValues } from "./system-config";

export interface SystemCheck {
  service: "web" | "inference" | "comfyui" | "bridge";
  status: "healthy" | "busy" | "error" | "unchecked";
  duration_ms: number;
  reason?: string;
  address?: string;
  interface_ready?: boolean;
  queue?: { running: number; pending: number };
  dependencies?: { workflow: string; status: "healthy" | "error" | "unchecked"; missing_nodes: string[]; missing_models: string[] }[];
}
export interface SystemReport { checked_at: string; checks: SystemCheck[] }
export type DiagnosticFetch = (input: string, init?: RequestInit) => Promise<Response>;
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function count(v: unknown): v is number { return Number.isSafeInteger(v) && Number(v) >= 0; }
function texts(v: unknown): v is string[] { return Array.isArray(v) && v.every(x=>typeof x === "string"); }
function readChecks(data: unknown): SystemCheck[] {
  if (!record(data) || typeof data.checked_at !== "string" || !Number.isFinite(Date.parse(data.checked_at)) || !Array.isArray(data.checks) || data.checks.length !== 2) throw new Error("invalid_response");
  const seen = new Set<string>();
  return data.checks.map(value => {
    if (!record(value) || (value.service !== "comfyui" && value.service !== "bridge") || seen.has(value.service) || !["healthy","busy","error","unchecked"].includes(String(value.status)) || typeof value.duration_ms !== "number" || !Number.isFinite(value.duration_ms) || value.duration_ms < 0) throw new Error("invalid_response");
    seen.add(value.service);
    const check: SystemCheck = { service:value.service, status:value.status as SystemCheck["status"], duration_ms:value.duration_ms };
    if (typeof value.address === "string") check.address = value.address;
    if (typeof value.reason === "string") check.reason = value.reason;
    if (typeof value.interface_ready === "boolean") check.interface_ready = value.interface_ready;
    if (value.queue !== undefined) {
      if (!record(value.queue) || !count(value.queue.running) || !count(value.queue.pending)) throw new Error("invalid_response");
      check.queue = {running:value.queue.running,pending:value.queue.pending};
    }
    if (value.dependencies !== undefined) {
      if (!Array.isArray(value.dependencies)) throw new Error("invalid_response");
      check.dependencies = value.dependencies.map(dep => {
        if (!record(dep) || typeof dep.workflow !== "string" || !["healthy","error","unchecked"].includes(String(dep.status)) || !texts(dep.missing_nodes) || !texts(dep.missing_models)) throw new Error("invalid_response");
        return { workflow:dep.workflow,status:dep.status as "healthy"|"error"|"unchecked", missing_nodes:dep.missing_nodes,missing_models:dep.missing_models };
      });
    }
    return check;
  });
}
const errorReason = (error: unknown): string => {
  if (error instanceof Error && ["AbortError","TimeoutError"].includes(error.name)) return "检测超时";
  if (error instanceof Error && error.message === "backend_policy") return "后端地址未加入部署白名单或地址格式无效";
  if (error instanceof Error && error.message === "invalid_response") return "响应格式异常";
  if (error instanceof Error && /^HTTP \d+$/.test(error.message)) return error.message;
  return "连接失败或重定向被拒绝";
};

/** Only these two read-only endpoints are used; no GPU tasks or credits. */
export function diagnosticRunner(fetcher: DiagnosticFetch) {
  const inFlight = new Map<string, Promise<SystemReport>>();
  return (values: BackendValues): Promise<SystemReport> => {
    const address = (process.env.INFERENCE_BASE_URL ?? "http://127.0.0.1:8100").replace(/\/+$/, "");
    const key = JSON.stringify([values,address,process.env.KELVOY_BACKEND_ALLOWED_ORIGINS]);
    const previous = inFlight.get(key);
    if (previous) return previous;
    const pending = run(values,address,fetcher).finally(()=>inFlight.delete(key));
    inFlight.set(key,pending);
    return pending;
  };
}
async function run(values: BackendValues, address: string, fetcher: DiagnosticFetch): Promise<SystemReport> {
  const started = Date.now();
  const overall = AbortSignal.timeout(15_000);
  const checks: SystemCheck[] = [{service:"web",status:"healthy",duration_ms:0}];
  const health = (async (): Promise<SystemCheck> => {
    const begin = Date.now();
    try {
      const res = await fetcher(`${address}/health`, {redirect:"error",signal:AbortSignal.any([overall,AbortSignal.timeout(5_000)])});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!record(body) || body.status !== "ok") throw new Error("invalid_response");
      return {service:"inference",status:"healthy",duration_ms:Date.now()-begin,address};
    } catch(error) { return {service:"inference",status:"error",duration_ms:Date.now()-begin,address,reason:errorReason(error)}; }
  })();
  const dependencies = (async (): Promise<SystemCheck[]> => {
    try {
      if (!parseBackendValues(values)) throw new Error("backend_policy");
      const res = await fetcher(`${address}/system/diagnostics`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values),redirect:"error",signal:AbortSignal.any([overall,AbortSignal.timeout(5_000)])});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return readChecks(await res.json());
    } catch(error) {
      return (["comfyui","bridge"] as const).map(service=>({service,status:"unchecked",duration_ms:Date.now()-started,reason:errorReason(error)}));
    }
  })();
  const [inference, downstream] = await Promise.all([health,dependencies]);
  checks.push(inference,...downstream);
  return {checked_at:new Date().toISOString(),checks};
}
export function simplifyReport(report: SystemReport): SystemReport {
  return {checked_at:report.checked_at,checks:report.checks.map(({service,status,duration_ms})=>({service,status,duration_ms,
    ...(status === "error" ? {reason:"服务异常，请联系运维"} : status === "unchecked" ? {reason:"未完成检查，请重试或联系运维"} : {})}))};
}
