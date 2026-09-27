import { lstat, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

// Inference requests time out within minutes. Keep a full hour of slack so
// this sweep never competes with a live download or worker archive.
const STALE_AFTER_MS = 60 * 60 * 1000;
const MEDIA_NAME = /^[0-9a-f]{32}\.(?:png|mp4)(?:\.tmp-[0-9a-f]{32})?$/;

export async function cleanupStaleInferenceMedia(now = Date.now()): Promise<number> {
  const root = resolve(process.env.KELVOY_PROJECTS_ROOT ?? "projects");
  let removed = 0;
  const inferenceRoot = join(root, "inference");
  try {
    if (!(await lstat(inferenceRoot)).isDirectory()) return 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  for (const kind of ["image", "video"]) {
    const dir = join(inferenceRoot, kind);
    let entries;
    try {
      if (!(await lstat(dir)).isDirectory()) continue;
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !MEDIA_NAME.test(entry.name)) continue;
      const path = join(dir, entry.name);
      try {
        const info = await lstat(path);
        if (!info.isFile() || now - info.mtimeMs < STALE_AFTER_MS) continue;
        await rm(path);
        removed++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return removed;
}
