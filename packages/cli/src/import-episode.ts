import { validateEpisode } from "@kelvoy/engine";
import { insertEpisode } from "@kelvoy/store";

export interface ImportEpisodeResult {
  ok: boolean;
  episode_id?: string;
  errors?: string[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Validates then inserts a hand-written episode JSON (M1-7) — same
 * validate-first-write-never-on-error discipline as import-destination.ts.
 * `episode_id` collisions (SQLite primary key) surface as a normal error,
 * not a crash.
 */
export async function importEpisode(raw: unknown): Promise<ImportEpisodeResult> {
  const result = validateEpisode(raw);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  try {
    await insertEpisode(result.value);
  } catch (err) {
    return { ok: false, errors: [`写入失败（episode_id 可能已存在）：${errorMessage(err)}`] };
  }
  return { ok: true, episode_id: result.value.episode_id };
}
