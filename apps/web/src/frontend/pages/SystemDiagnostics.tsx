import { useEffect, useReducer, useRef } from "react";
import { getSystemConfig, saveSystemConfig, testSystem, type DiagnosticStatus, type SystemTestResult } from "../api/system";
import { Button, Field, Status } from "../ui";
import { createDiagnosticsActionRunner, diagnosticErrors, diagnosticsReducer, initialDiagnosticsState } from "./system-diagnostics";

const labels = { web: "Web", inference: "Inference", comfyui: "ComfyUI", bridge: "bridge" };
const statusLabels = { healthy: "正常", busy: "忙碌", error: "异常", unchecked: "未检查" };
const statusTone = { healthy: "success", busy: "warning", error: "danger", unchecked: "neutral" } as const;
function CheckStatus({ status }: { status: DiagnosticStatus }) {
  return <Status tone={statusTone[status]}>{statusLabels[status]}</Status>;
}

export function DiagnosticsResults({ result, operator, stale }: {
  result: SystemTestResult; operator: boolean; stale: boolean;
}) {
  return <div className="k-system-results" aria-live="polite">
    <p className="k-card-meta">检测时间：{new Date(result.checked_at).toLocaleString()}
      {stale && <span role="status"> · 结果已过期，请重新测试当前输入</span>}</p>
    <ul className="k-system-checks">
      {result.checks.map((check) => <li key={check.service}>
        <div className="k-system-check-heading"><strong>{labels[check.service]}</strong>
          <CheckStatus status={check.status} /><span className="k-card-meta">{check.duration_ms} ms</span></div>
        {check.service === "bridge" && <p className="k-card-meta">伴随服务，当前生成链路不依赖。</p>}
        {check.reason && <p>{check.reason}</p>}
        {operator && check.address && <p className="k-system-address">{check.address}</p>}
        {operator && check.queue && <p className="k-card-meta">队列：运行 {check.queue.running} · 等待 {check.queue.pending}</p>}
        {operator && check.dependencies && <details>
          <summary>工作流依赖详情</summary>
          {check.dependencies.map((dependency) => <div key={dependency.workflow} className="k-system-dependency">
            <strong>{dependency.workflow}</strong> <CheckStatus status={dependency.status} />
            {dependency.missing_nodes.length > 0 && <p>缺失节点：{dependency.missing_nodes.join("、")}</p>}
            {dependency.missing_models.length > 0 && <p>缺失模型：{dependency.missing_models.join("、")}</p>}
          </div>)}
        </details>}
      </li>)}
    </ul>
  </div>;
}

export default function SystemDiagnostics() {
  const [state, dispatch] = useReducer(diagnosticsReducer, initialDiagnosticsState);
  // State updates render asynchronously; this lock also blocks two clicks in the same tick.
  const runExclusive = useRef(createDiagnosticsActionRunner());
  const mounted = useRef(true);

  async function load() {
    await runExclusive.current(async () => {
      dispatch({ type: "start", action: "load" });
      const result = await getSystemConfig();
      if (!mounted.current) return;
      if (result.ok) dispatch({ type: "loaded", data: result });
      else dispatch({ type: "failed", error: result.error ?? "invalid_response" });
    });
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, []);

  async function run(action: "test" | "save" | "restore") {
    if (!state.loaded) return;
    if (action !== "test" && (!state.operator || !state.config)) return;
    await runExclusive.current(async () => {
      dispatch({ type: "start", action });
      const candidate = action === "restore"
        ? { comfyui_base_url: null, bridge_base_url: null }
        : { comfyui_base_url: state.comfyui.trim() || null, bridge_base_url: state.bridge.trim() || null };
      if (action === "test") {
        const result = await testSystem(state.operator ? candidate : undefined);
        if (mounted.current) {
          if (result.ok) dispatch({ type: "tested", result });
          else dispatch({ type: "failed", error: result.error ?? "diagnostics_failed" });
        }
      } else {
        const result = await saveSystemConfig({ ...candidate, version: state.config!.version });
        if (mounted.current) {
          if (result.ok) dispatch({ type: "saved", config: result.config });
          else dispatch({ type: "failed", error: result.error ?? "invalid_response" });
        }
      }
    });
  }

  const busy = state.pending !== null;
  return <section className="k-card k-system-card" aria-busy={busy}>
    <h2>系统检测</h2>
    <p className="k-card-meta">只读检测接口、队列及工作流依赖，不提交生成任务，不消耗积分。检测最多 15 秒；通过不代表模型加载或实际出图成功。</p>
    <p className="k-card-meta">生成链路：Worker → Inference → ComfyUI。Worker 没有 HTTP 端口，此处未检查其进程存活。bridge 是伴随服务，当前生成链路不依赖。</p>
    {state.pending === "load" && <p role="status">正在加载系统配置…</p>}
    {state.error && <p className="k-error" role="alert">{diagnosticErrors[state.error] ?? "操作失败，请重试。"}</p>}
    {!state.loaded && state.pending !== "load" && <Button variant="secondary" onClick={() => void load()}>重新加载</Button>}
    {state.loaded && <>
      {state.operator && state.config && <div className="k-settings-form">
        <Field label="全站 ComfyUI 地址">
          <input value={state.comfyui} disabled={busy} placeholder="留空继承部署配置"
            onChange={(event) => dispatch({ type: "edit", field: "comfyui", value: event.target.value })} />
        </Field>
        <p className="k-card-meta k-system-address">继承地址由推理服务配置，检测后显示实际地址。</p>
        <Field label="bridge 检测地址">
          <input value={state.bridge} disabled={busy} placeholder="留空继承部署配置"
            onChange={(event) => dispatch({ type: "edit", field: "bridge", value: event.target.value })} />
        </Field>
        <p className="k-card-meta k-system-address">继承地址由推理服务配置，检测后显示实际地址。</p>
        <p className="k-card-meta">测试当前输入不会保存。地址须先加入部署白名单；保存只影响之后的任务。缺失节点或模型会报告异常，但不会阻止保存接口可达的后端。</p>
        {state.config.updated_at && <p className="k-card-meta">版本 {state.config.version} · {state.config.updated_by} 于 {new Date(state.config.updated_at).toLocaleString()} 修改</p>}
      </div>}
      <div className="k-settings-actions k-system-actions">
        <Button disabled={busy} onClick={() => void run("test")}>{state.pending === "test" ? "检测中…" : state.operator ? "测试当前输入" : "检测当前配置"}</Button>
        {state.operator && state.config && <>
          <Button variant="secondary" disabled={busy} onClick={() => void run("save")}>{state.pending === "save" ? "保存中…" : "保存配置"}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run("restore")}>{state.pending === "restore" ? "恢复中…" : "恢复继承"}</Button>
        </>}
        {state.saved && <span className="k-card-meta" role="status">全站配置已保存</span>}
      </div>
      {state.result && <DiagnosticsResults result={state.result} operator={state.operator} stale={state.stale} />}
    </>}
  </section>;
}
