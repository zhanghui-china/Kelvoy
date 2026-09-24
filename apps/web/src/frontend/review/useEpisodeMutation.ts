import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WriteResult } from "../api/client";
import { describeWriteError } from "./errors";

export interface EpisodeMutation {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  /**
   * 跑一次写请求：自动带上当前 row_version，成功后立刻重新拉一次期数据，
   * 401 跳登录，409 提示"期已被更新，正在刷新"并重新拉取。返回原始结果，
   * 方便调用方串两步（改 prompt → 重生成）或读新的 row_version。
   */
  run: (call: (rowVersion: number) => Promise<WriteResult>) => Promise<WriteResult | null>;
}

/**
 * 审片台所有写操作的唯一入口（FR-05/§9）。row_version 从最近一次 GET 来，
 * 但写请求自己返回的更新（+1）比下一次轮询更早到，所以两边取最大的那个——
 * 乐观锁计数器单调递增，取 max 不会用到旧值。
 */
export function useEpisodeMutation(rowVersion: number, refresh: () => void): EpisodeMutation {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const rowVersionRef = useRef(rowVersion);
  rowVersionRef.current = Math.max(rowVersionRef.current, rowVersion);

  const run = useCallback<EpisodeMutation["run"]>(
    async (call) => {
      setPending(true);
      setError(null);
      const result = await call(rowVersionRef.current);
      setPending(false);

      if (!result.ok) {
        if (result.error === "unauthorized") {
          navigate("/login");
          return null;
        }
        setError(describeWriteError(result));
        if (result.error === "version_conflict") {
          if (typeof result.current_row_version === "number") {
            rowVersionRef.current = result.current_row_version;
          }
          refresh();
        }
        return result;
      }

      rowVersionRef.current = Math.max(rowVersionRef.current, result.row_version);
      refresh();
      return result;
    },
    [navigate, refresh],
  );

  const clearError = useCallback(() => setError(null), []);
  return { pending, error, clearError, run };
}
