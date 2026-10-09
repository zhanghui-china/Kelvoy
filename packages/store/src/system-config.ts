import { getDb } from "./db";

/** Site-wide overrides, separate from personal settings. Null inherits deployment values. */
export interface SystemConfig {
  version: number;
  comfyui_base_url: string | null;
  bridge_base_url: string | null;
  updated_by: string | null;
  updated_at: string | null;
}
export type SystemConfigValues = Pick<SystemConfig, "comfyui_base_url" | "bridge_base_url">;
export type SaveSystemConfigResult = { ok: true; config: SystemConfig }
  | { ok: false; error: "version_conflict" | "tasks_active" };

function readConfig(): SystemConfig {
  return getDb().query<SystemConfig, []>(`select version, comfyui_base_url, bridge_base_url,
    updated_by, updated_at from system_config where id = 1`).get()!;
}

export async function getSystemConfig(): Promise<SystemConfig> {
  return readConfig();
}

/** The write lock serializes the queue check and revision check with task enqueue/dequeue. */
export async function saveSystemConfig(expectedVersion: number, values: SystemConfigValues,
  actor: string): Promise<SaveSystemConfigResult> {
  const database = getDb();
  return database.transaction((): SaveSystemConfigResult => {
    if (readConfig().version !== expectedVersion) return { ok: false, error: "version_conflict" };
    const active = database.query<{ task_id: string }, []>(
      "select task_id from tasks where status in ('held', 'pending', 'processing') limit 1",
    ).get();
    if (active) return { ok: false, error: "tasks_active" };
    database.query(`update system_config set version = version + 1, comfyui_base_url = ?,
      bridge_base_url = ?, updated_by = ?, updated_at = ? where id = 1`)
      .run(values.comfyui_base_url, values.bridge_base_url, actor, new Date().toISOString());
    return { ok: true, config: readConfig() };
  }).immediate();
}
