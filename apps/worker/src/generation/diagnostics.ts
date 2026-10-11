import { llmTimeoutSeconds, type H3PromptWriter } from "@kelvoy/engine";
import { classifyH3Failure, GenerationError } from "./errors";

/**
 * Observability only: the log line and the thrown diagnostic carry rule/corrected/timing, never the
 * user message, final prompt or model response. Prompt records go through a separate trace sink and
 * are written in the task settlement transaction (see ADR-0012).
 */
export function observeH3Rewrite(writer: H3PromptWriter, correlation: { task_id: string; shot_id?: string; attempt: number }): H3PromptWriter {
  return { async write(input) {
    const started = performance.now();
    let code = "success";
    let rule: string | undefined;
    let corrected: boolean | undefined;
    try { return await writer.write(input); }
    catch (error) {
      if (input.signal?.aborted) { code = "cancelled"; throw error; }
      const failure = classifyH3Failure(error);
      rule = failure.rule; corrected = failure.corrected; code = failure.code;
      throw new GenerationError({ stage: "prompt_rewrite", code,
        message: failure.blocked ? "内容未通过审核，请修改创作要求后重新提交。"
          : failure.invalid ? (corrected ? "视频提示词格式校正后仍无效，请联系团队排查。" : "视频提示词未通过规则校验，请联系团队排查。")
          : "视频提示词改写失败，请稍后重试。",
        elapsed_seconds: (performance.now() - started) / 1000,
        budget_seconds: llmTimeoutSeconds(), cancellation: "not_needed", ...(rule ? { rule } : {}),
      }, failure.retryable);
    } finally {
      console.info(JSON.stringify({ ...correlation, stage: "prompt_rewrite", code,
        ...(rule ? { rule } : {}), ...(corrected === undefined ? {} : { corrected }),
        elapsed_seconds: (performance.now() - started) / 1000 }));
    }
  } };
}
