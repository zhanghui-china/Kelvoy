import { ContentBlockedError } from "@kelvoy/engine";
import type { InferenceError } from "../inference-client";
import { videoTimeoutSeconds } from "../inference-client";
import { H3FormatError } from "./h3-prompt-format";

export interface H3FailureClass {
  /** Diagnostic code (tasks.error / log line). */
  code: "content_blocked" | "prompt_format_invalid" | "prompt_rewrite_timeout" | "prompt_rewrite_failed";
  /** Same vocabulary, stored on prompt traces so the two views never drift apart. */
  outcome: string;
  blocked: boolean;
  invalid: boolean;
  /** Only the fixed H3FormatError identifiers, never the message. */
  rule?: string;
  corrected?: boolean;
  retryable: boolean;
}

/** Shared by the diagnostics wrapper and the prompt writer's trace: one place decides what a failure is called. */
export function classifyH3Failure(error: unknown): H3FailureClass {
  const blocked = error instanceof ContentBlockedError;
  const invalid = error instanceof H3FormatError;
  const timeout = error instanceof Error && /timed out|timeout/i.test(error.message);
  const code = blocked ? "content_blocked" : invalid ? "prompt_format_invalid"
    : timeout ? "prompt_rewrite_timeout" : "prompt_rewrite_failed";
  // Model output is stochastic, so a format/validation failure is not deterministic: it gets the same single
  // local retry as timeouts (consumer MAX_LOCAL_ATTEMPTS). Only content blocks are terminal here.
  return { code, outcome: code, blocked, invalid, retryable: !blocked,
    ...(invalid ? { rule: error.rule, corrected: error.corrected } : {}) };
}

export interface GenerationDiagnostic {
  stage: string;
  code: string;
  message: string;
  elapsed_seconds: number;
  budget_seconds: number;
  cancellation: "confirmed" | "unconfirmed" | "failed" | "not_needed";
  /** Fixed validation rule identifier for prompt_rewrite failures; never model output. */
  rule?: string;
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
