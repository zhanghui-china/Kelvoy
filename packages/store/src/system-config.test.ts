import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, getDb, open } from "./db";
import { getSystemConfig, saveSystemConfig } from "./system-config";

beforeEach(() => open(":memory:"));
afterEach(close);
const values = { comfyui_base_url: "http://gpu:8188", bridge_base_url: "http://gpu:5099" };

test("singleton starts inherited and saves metadata then clears overrides", async () => {
  expect(await getSystemConfig()).toEqual({ version: 1, comfyui_base_url: null,
    bridge_base_url: null, updated_by: null, updated_at: null });
  const saved = await saveSystemConfig(1, values, "operator");
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error("save failed");
  expect(saved.config).toMatchObject({ ...values, version: 2, updated_by: "operator" });
  expect(saved.config.updated_at).toBeTruthy();
  const cleared = await saveSystemConfig(2, { comfyui_base_url: null, bridge_base_url: null }, "operator");
  expect(cleared.ok).toBe(true);
  expect(await getSystemConfig()).toMatchObject({ version: 3, comfyui_base_url: null, bridge_base_url: null });
});

test("stale revision cannot overwrite current values", async () => {
  await saveSystemConfig(1, values, "operator");
  expect(await saveSystemConfig(1, { comfyui_base_url: null, bridge_base_url: null }, "other"))
    .toEqual({ ok: false, error: "version_conflict" });
  expect(await getSystemConfig()).toMatchObject({ ...values, version: 2 });
});

for (const status of ["held", "pending", "processing"]) {
  test(`global ${status} task blocks changes`, async () => {
    getDb().query("insert into tasks (task_id, episode_id, stage, status) values (?, ?, ?, ?)")
      .run("other-user-task", "other-episode", "script", status);
    expect(await saveSystemConfig(1, values, "operator")).toEqual({ ok: false, error: "tasks_active" });
    expect((await getSystemConfig()).version).toBe(1);
  });
}

test("finished tasks allow changes", async () => {
  for (const status of ["done", "failed", "cancelled"]) {
    getDb().query("insert into tasks (task_id, episode_id, stage, status) values (?, ?, ?, ?)")
      .run(status, "e", "script", status);
  }
  expect((await saveSystemConfig(1, values, "operator")).ok).toBe(true);
});


test("singleton overrides survive reopen without resetting version", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kelvoy-config-"));
  const path = join(directory, "store.db");
  try {
    open(path);
    await saveSystemConfig(1, values, "operator");
    close();
    open(path);
    expect(await getSystemConfig()).toMatchObject({ ...values, version: 2, updated_by: "operator" });
  } finally {
    close();
    rmSync(directory, { recursive: true, force: true });
  }
});
