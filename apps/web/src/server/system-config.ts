/** Deployment policy is deliberately independent of account settings/roles. */
export function isOperator(userId: string): boolean {
  return (process.env.KELVOY_OPERATOR_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).includes(userId);
}
export type BackendValues = { comfyui_base_url: string | null; bridge_base_url: string | null };
export function validateBackendUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\\?#\s]/.test(value)) throw new Error("invalid_config");
  const rawPath = value.replace(/^https?:\/\/[^/]+/, "");
  const decoded = decodeURIComponent(rawPath);
  if (/[\\\x00-\x1f]/.test(decoded) || decoded.split("/").some(part=>part === "." || part === "..")) throw new Error("invalid_config");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error("invalid_config");
  const origins = (process.env.KELVOY_BACKEND_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!origins.includes(url.origin)) throw new Error("invalid_config");
  return url.href.replace(/\/+$/, "");
}
export function parseBackendValues(body: unknown, versionRequired = false): (BackendValues & { version?: number }) | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["version", "comfyui_base_url", "bridge_base_url"].includes(key))) return null;
  if (versionRequired && (!Number.isSafeInteger(value.version) || Number(value.version) < 1)) return null;
  if (value.version !== undefined && (!Number.isSafeInteger(value.version) || Number(value.version) < 1)) return null;
  try {
    const comfyui_base_url = value.comfyui_base_url === null ? null : validateBackendUrl(value.comfyui_base_url);
    const bridge_base_url = value.bridge_base_url === null ? null : validateBackendUrl(value.bridge_base_url);
    return { comfyui_base_url, bridge_base_url, ...(value.version === undefined ? {} : {version: Number(value.version)}) };
  } catch { return null; }
}
