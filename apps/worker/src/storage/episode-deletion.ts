import { lstat, rm } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";
import { failEpisodeDeletionCleanup, finishEpisodeDeletionCleanup,
  listPendingEpisodeDeletions } from "@kelvoy/store";

const SHARED_DIRECTORIES = new Set(["persona", "dest", "music", "lut", "inference", "templates", "intro", "outro"]);

/** Reject symlinked ancestors; rm removes contained symlinks without traversing them. */
async function removeEpisodeDirectory(episodeId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(episodeId) || SHARED_DIRECTORIES.has(episodeId)) {
    throw new Error("unsafe episode directory");
  }
  const root = resolve(process.env.KELVOY_PROJECTS_ROOT ?? "projects");
  const parsed = parse(root);
  let ancestor = parsed.root;
  // macOS's /tmp and /var are conventional symlinks. The configured root is
  // resolved by operators; require a concrete root to avoid deleting shared trees.
  for (const part of root.slice(parsed.root.length).split("/").filter(Boolean)) {
    ancestor = join(ancestor, part);
    try {
      const info = await lstat(ancestor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe projects root");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  const target = join(root, episodeId);
  if (isAbsolute(episodeId) || target === root) throw new Error("unsafe episode directory");
  await rm(target, { recursive: true, force: true });
}

/** Durable queue comes from store, never from scanning arbitrary orphan directories. */
export async function cleanupDeletedEpisodes(
  removeDirectory: (episodeId: string) => Promise<void> = removeEpisodeDirectory,
): Promise<number> {
  let cleaned = 0;
  for (const record of await listPendingEpisodeDeletions()) {
    try {
      await removeDirectory(record.episode_id);
      if (await finishEpisodeDeletionCleanup(record.episode_id, record.cleanup_revision)) cleaned++;
    } catch {
      // No filesystem path, prompts or raw exception details enter logs/audit records.
      await failEpisodeDeletionCleanup(record.episode_id);
      console.warn("episode cleanup deferred", { episode_id: record.episode_id });
    }
  }
  return cleaned;
}
