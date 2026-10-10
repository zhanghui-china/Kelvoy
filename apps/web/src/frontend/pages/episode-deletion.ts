import type { ApiResult } from "../api/client";

/** Lock synchronously: two clicks can precede React's pending-state render. */
export function episodeDeletion(input: {
  request: () => Promise<ApiResult<object>>;
  busy: (value: boolean) => void;
  error: (message: string | null) => void;
  success: () => void;
  missing: () => void;
  login: () => void;
}): () => Promise<void> {
  let active = false;
  return async () => {
    if (active) return;
    active = true;
    input.busy(true);
    input.error(null);
    try {
      const result = await input.request();
      if (result.ok) input.success();
      else if (result.error === "unauthorized") input.login();
      else if (result.error === "not_found") input.missing();
      else input.error("删除失败，请重试。");
    } catch {
      input.error("删除失败，请重试。");
    } finally {
      active = false;
      input.busy(false);
    }
  };
}
