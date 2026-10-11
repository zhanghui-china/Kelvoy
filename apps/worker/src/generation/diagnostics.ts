import { ContentBlockedError, type H3PromptWriter } from "@kelvoy/engine";
import { GenerationError } from "./errors";
import { H3FormatError } from "./h3-prompt-format";

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
      const blocked = error instanceof ContentBlockedError;
      const invalid = error instanceof H3FormatError;
      if (invalid) { rule = error.rule; corrected = error.corrected; }
      const timeout = error instanceof Error && /timed out|timeout/i.test(error.message);
      code = blocked ? "content_blocked" : invalid ? "prompt_format_invalid"
        : timeout ? "prompt_rewrite_timeout" : "prompt_rewrite_failed";
      throw new GenerationError({ stage: "prompt_rewrite", code,
        message: blocked ? "内容未通过审核，请修改创作要求后重新提交。"
          : invalid ? (corrected ? "视频提示词格式校正后仍无效，请联系团队排查。" : "视频提示词未通过规则校验，请联系团队排查。")
          : "视频提示词改写失败，请稍后重试。",
        elapsed_seconds: (performance.now() - started) / 1000,
        budget_seconds: 60, cancellation: "not_needed", ...(rule ? { rule } : {}),
      }, !blocked && !invalid);
    } finally {
      console.info(JSON.stringify({ ...correlation, stage: "prompt_rewrite", code,
        ...(rule ? { rule } : {}), ...(corrected === undefined ? {} : { corrected }),
        elapsed_seconds: (performance.now() - started) / 1000 }));
    }
  } };
}
