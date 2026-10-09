import type { SystemConfig, SystemConfigResponse, SystemTestResult } from "../api/system";

export interface DiagnosticsState {
  loaded: boolean;
  operator: boolean;
  config?: SystemConfig;
  comfyui: string;
  bridge: string;
  pending: "load" | "test" | "save" | "restore" | null;
  error: string | null;
  saved: boolean;
  result: SystemTestResult | null;
  stale: boolean;
}
export const initialDiagnosticsState: DiagnosticsState = {
  loaded: false, operator: false, comfyui: "", bridge: "", pending: null,
  error: null, saved: false, result: null, stale: false,
};
type Action =
  | { type: "loaded"; data: SystemConfigResponse }
  | { type: "start"; action: NonNullable<DiagnosticsState["pending"]> }
  | { type: "edit"; field: "comfyui" | "bridge"; value: string }
  | { type: "tested"; result: SystemTestResult }
  | { type: "saved"; config: SystemConfig }
  | { type: "failed"; error: string };
export function diagnosticsReducer(state: DiagnosticsState, action: Action): DiagnosticsState {
  switch (action.type) {
    case "loaded": return { ...state, ...action.data, loaded: true, pending: null, error: null,
      comfyui: action.data.config?.comfyui_base_url ?? "", bridge: action.data.config?.bridge_base_url ?? "" };
    case "start": return { ...state, pending: action.action, error: null, saved: false };
    case "edit": return { ...state, [action.field]: action.value, stale: state.result !== null, saved: false };
    case "tested": return { ...state, result: action.result, stale: false, pending: null, error: null };
    case "saved": return { ...state, config: action.config, comfyui: action.config.comfyui_base_url ?? "",
      bridge: action.config.bridge_base_url ?? "", pending: null, error: null, saved: true, stale: state.result !== null };
    case "failed": return { ...state, pending: null, error: action.error };
  }
}
export const diagnosticErrors: Record<string, string> = {
  forbidden: "此账号没有全站运维权限。", invalid_config: "地址无效或未加入部署白名单，请检查后重试。",
  version_conflict: "配置已被其他运维账号修改。请重新加载页面核对配置；当前输入已保留。",
  tasks_active: "当前有等待、保留或处理中的任务，请在队列空闲后保存。",
  backend_unreachable: "ComfyUI 接口验证失败，配置未保存。", diagnostics_failed: "检测服务暂时不可用，请重试。",
  timeout: "请求超时，请重试。若正在保存，请重新加载页面确认最新配置。",
  network_error: "网络请求失败，请重试。", invalid_response: "服务返回了无效响应，请重试。",
};

/** Synchronous guard covers action startup before React can disable controls. */
export function createDiagnosticsActionRunner() {
  let active = false;
  return async (action: () => Promise<void>): Promise<void> => {
    if (active) return;
    active = true;
    try { await action(); }
    finally { active = false; }
  };
}
