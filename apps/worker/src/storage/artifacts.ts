import { mkdir, copyFile, link, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { hasEpisodeDeletion, requestEpisodeDeletionCleanup } from "@kelvoy/store";

/** Persistent fence also protects resumed writers whose in-memory abort was lost. */
export function assertEpisodePublicationAllowed(episodeId: string, signal?: AbortSignal): void {
  if (hasEpisodeDeletion(episodeId)) {
    requestEpisodeDeletionCleanup(episodeId);
    throw new Error("episode deleted");
  }
  signal?.throwIfAborted();
}

/**
 * Local artifact storage (ADR-0004): no object storage/SDK, just files on
 * disk under PROJECTS_ROOT — mirrors visionary's projects/ directory
 * pattern. Layout: <root>/<episode_id>/<relativeKey>, e.g.
 * "e_1/kf/07_a.png", matching the path shape PRD v0.2 §9 used for the
 * object-storage version (episodes/<id>/kf/07_a.png) so nothing in the
 * schema (Shot.candidates, .clip, etc.) needs to change — those fields
 * always just held a path string.
 */
function projectsRoot(): string {
  return process.env.KELVOY_PROJECTS_ROOT ?? "projects";
}

/** Moves a locally-generated file into the episode's artifact directory. */
export async function saveArtifact(
  episodeId: string,
  relativeKey: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<string> {
  assertEpisodePublicationAllowed(episodeId, signal);
  await mkdir(projectsRoot(), { recursive: true });
  assertEpisodePublicationAllowed(episodeId, signal);
  const destPath = artifactPath(episodeId, relativeKey);
  await mkdir(dirname(destPath), { recursive: true });
  assertEpisodePublicationAllowed(episodeId, signal);
  // mkdir can follow an existing symlink. Recheck the concrete parent before writing.
  artifactPath(episodeId, relativeKey);
  const tempPath = `${destPath}.tmp-${crypto.randomUUID()}`;
  try {
    await copyFile(sourcePath, tempPath);
    assertEpisodePublicationAllowed(episodeId, signal);
    await link(tempPath, destPath);
    assertEpisodePublicationAllowed(episodeId, signal);
  } finally {
    await rm(tempPath, { force: true });
  }
  return destPath;
}

/** Resolves a stored relative key back to its full path on disk. */
export function artifactPath(episodeId: string, relativeKey: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(episodeId) || !relativeKey || isAbsolute(relativeKey) ||
      relativeKey.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new Error("invalid episode artifact key");
  }
  const root = resolve(projectsRoot());
  const episodeRoot = resolve(root, episodeId);
  const target = resolve(episodeRoot, relativeKey);
  const inside = relative(episodeRoot, target);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error("invalid episode artifact key");
  }
  try {
    const realRoot = realpathSync(root);
    let existing = target;
    while (existing !== root) {
      try {
        const concrete = realpathSync(existing);
        const realInside = relative(realRoot, concrete);
        if (!realInside || realInside === ".." || realInside.startsWith(`..${sep}`) ||
            isAbsolute(realInside)) throw new Error("episode artifact escapes projects root");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        existing = dirname(existing);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

/**
 * Resolves a *shared* (not episode-scoped) asset key: the music library,
 * account LUTs, and template intro/outro clips live directly under the
 * projects root because they're reused across every episode —
 * <root>/music/calm_morning.mp3, <root>/lut/warm_film.cube. Those files are
 * put there by hand (see apps/worker/README.md), not produced by the pipeline.
 */
export function sharedAssetPath(relativeKey: string): string {
  // Older official role records used a style name before the actual LUT was
  // packaged. Keep those immutable role snapshots usable during compose.
  const key = relativeKey === "warm_natural" ? "lut/warm_film.cube" : relativeKey;
  if (isAbsolute(key) || key.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new Error("invalid shared asset key");
  }
  const root = resolve(projectsRoot());
  const path = resolve(root, key);
  const inside = relative(root, path);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error("invalid shared asset key");
  try {
    const realRoot = realpathSync(root);
    const realPath = realpathSync(path);
    const realInside = relative(realRoot, realPath);
    if (!realInside || realInside.startsWith("..") || isAbsolute(realInside)) {
      throw new Error("shared asset escapes projects root");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return path;
}
