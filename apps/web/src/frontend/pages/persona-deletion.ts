import type { ApiResult } from "../api/client";

/** A synchronous lock covers confirmation and the request before React rerenders. */
export function personaDeletion(input: {
  name: string;
  confirm: (message: string) => boolean;
  request: () => Promise<ApiResult<object>>;
  busy: (value: boolean) => void;
  error: (message: string | null) => void;
  refresh: (message: string) => void;
  login: () => void;
}): () => Promise<void> {
  let active = false;
  return async () => {
    if (active) return;
    active = true;
    try {
      if (!input.confirm(`确定删除角色「${input.name}」？删除后不能用于新建一期；已有作品、历史版本及照片会保留。`)) return;
      input.busy(true);
      input.error(null);
      const result = await input.request();
      if (result.ok) input.refresh("角色已删除。");
      else if (result.error === "unauthorized") input.login();
      else if (result.error === "version_conflict") input.refresh("角色已被更新，列表已刷新。请检查最新版本后重新删除。");
      else input.error("删除失败，请重试。");
    } catch {
      input.error("删除失败，请重试。");
    } finally {
      active = false;
      input.busy(false);
    }
  };
}
