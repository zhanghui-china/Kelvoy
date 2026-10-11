import { expect, test } from "bun:test";
import { decodeTaskDiagnostic } from "./task-diagnostics";

test("composition and model diagnostics validate independently", () => {
  const compose = { stage:"compose", code:"asset_missing", message:"安全原因", elapsed_seconds:0.5 } as const;
  expect(decodeTaskDiagnostic(JSON.stringify(compose))).toEqual(compose);
  expect(decodeTaskDiagnostic(JSON.stringify({...compose, budget_seconds:0, cancellation:"not_needed"}))).toBeNull();
  expect(decodeTaskDiagnostic(JSON.stringify({...compose, code:"unexpected"}))).toBeNull();
  expect(decodeTaskDiagnostic(JSON.stringify({...compose, elapsed_seconds:-1}))).toBeNull();
  const model = {...compose, stage:"comfyui_wait", code:"generation_timeout", budget_seconds:900, cancellation:"confirmed"} as const;
  expect(decodeTaskDiagnostic(JSON.stringify(model))).toEqual(model);
  expect(decodeTaskDiagnostic(JSON.stringify({...model, cancellation:"bogus"}))).toBeNull();
  expect(decodeTaskDiagnostic(JSON.stringify({...model, budget_seconds:"900"}))).toBeNull();
});
