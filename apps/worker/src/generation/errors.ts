import type { InferenceError } from "../inference-client";
import { videoTimeoutSeconds } from "../inference-client";

export interface GenerationDiagnostic {
  stage: string;
  code: string;
  message: string;
  elapsed_seconds: number;
  budget_seconds: number;
  cancellation: "confirmed" | "unconfirmed" | "failed" | "not_needed";
}

export class GenerationError extends Error {
  constructor(public diagnostic: GenerationDiagnostic, public retryable: boolean) {
    super(diagnostic.message);
  }
}

export function inferenceFailure(error: InferenceError, video: boolean): GenerationError {
  const budget = video ? videoTimeoutSeconds() : 240;
  if (error.type === "http_error" && error.detail) {
    return new GenerationError(error.detail, error.detail.code === "backend_unavailable");
  }
  const timeout = error.type === "timeout" || error.type === "http_error" && error.status === 504;
  const invalid = error.type === "invalid_request" || error.type === "http_error" && error.status < 500;
  const code = timeout ? "generation_timeout" : invalid ? "invalid_request" : "backend_unavailable";
  return new GenerationError({ stage: "inference_http", code,
    message: timeout ? `${video ? "视频" : "图片"}生成超过 ${budget / 60} 分钟，已请求停止，停止结果未确认。`
      : invalid ? "生成参数无效，请修改后重试。" : "生成服务暂时不可用，请稍后重试。",
    elapsed_seconds: timeout ? budget + 60 : 0, budget_seconds: budget, cancellation: "unconfirmed",
  }, !timeout && !invalid && error.type !== "invalid_response" && error.type !== "not_implemented");
}
