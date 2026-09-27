import { lstat, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDb } from "@kelvoy/store";

// Inference requests time out within minutes. Keep a full hour of slack so
// this sweep never competes with a live download or worker archive.
const STALE_AFTER_MS = 60 * 60 * 1000;
const MEDIA_NAME = /^[0-9a-f]{32}\.(?:png|mp4)(?:\.tmp-[0-9a-f]{32})?$/;
const EPISODE_ID = /^[a-zA-Z0-9_-]+$/;
const PUBLISH_TEMP = /\.tmp-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

async function plainDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function cleanupStaleEpisodeTemps(now = Date.now()): Promise<number> {
  const root = resolve(process.env.KELVOY_PROJECTS_ROOT ?? "projects");
  const episodes = getDb().query<{ episode_id: string }, []>("select episode_id from episodes").all();
  let removed = 0;
  for (const { episode_id: episodeId } of episodes) {
    if (!EPISODE_ID.test(episodeId)) continue;
    const episodeRoot = join(root, episodeId);
    if (!(await plainDirectory(episodeRoot))) continue;
    for (const kind of ["kf", "clip", "final"]) {
      const dir = join(episodeRoot, kind);
      if (!(await plainDirectory(dir))) continue;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !PUBLISH_TEMP.test(entry.name)) continue;
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
  }
  return removed;
}

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
