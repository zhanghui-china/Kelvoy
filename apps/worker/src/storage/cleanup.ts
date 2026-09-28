import { lstat, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getArtifactRetentionSnapshot, listArtifactEpisodeIds } from "@kelvoy/store";

// Inference requests time out within minutes. Keep a full hour of slack so
// this sweep never competes with a live download or worker archive.
const STALE_AFTER_MS = 60 * 60 * 1000;
const MEDIA_NAME = /^[0-9a-f]{32}\.(?:png|mp4)(?:\.tmp-[0-9a-f]{32})?$/;
const EPISODE_ID = /^[a-zA-Z0-9_-]+$/;
const PUBLISH_TEMP = /\.tmp-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const GENERATED_MEDIA: Record<"kf" | "clip", RegExp> = {
  kf: /^\d{2,}_[A-Za-z0-9_-]+_\d+(?:_retry_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?\.png$/,
  clip: /^\d{2,}_[A-Za-z0-9_-]+\.mp4$/,
};

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
  const episodes = listArtifactEpisodeIds();
  let removed = 0;
  for (const episodeId of episodes) {
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

/** Remove only crash-interrupted media without its cache metadata; complete versions stay. */
export async function cleanupIncompleteEpisodeMedia(now = Date.now()): Promise<number> {
  const root = resolve(process.env.KELVOY_PROJECTS_ROOT ?? "projects");
  let removed = 0;
  for (const episodeId of listArtifactEpisodeIds()) {
    if (!EPISODE_ID.test(episodeId)) continue;
    const episodeRoot = join(root, episodeId);
    if (!(await plainDirectory(episodeRoot))) continue;
    const snapshot = getArtifactRetentionSnapshot(episodeId);
    if (!snapshot || snapshot.hasUnsettledTasks) continue;
    for (const kind of ["kf", "clip"] as const) {
      const dir = join(episodeRoot, kind);
      if (!(await plainDirectory(dir))) continue;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !GENERATED_MEDIA[kind].test(entry.name)) continue;
        const key = `${kind}/${entry.name}`;
        if (snapshot.references.includes(key)) continue;
        const path = join(dir, entry.name);
        try {
          const info = await lstat(path);
          if (!info.isFile() || now - info.mtimeMs < STALE_AFTER_MS ||
              await plainFile(`${path}.meta.json`)) continue;
          const current = getArtifactRetentionSnapshot(episodeId);
          if (!current || current.hasUnsettledTasks || current.references.includes(key) ||
              await plainFile(`${path}.meta.json`)) continue;
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

async function plainFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() || info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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
