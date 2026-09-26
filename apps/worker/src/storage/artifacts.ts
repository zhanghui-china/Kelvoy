import { mkdir, copyFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

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
): Promise<string> {
  const destPath = join(projectsRoot(), episodeId, relativeKey);
  await mkdir(dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.tmp-${crypto.randomUUID()}`;
  try {
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, destPath);
  } finally {
    await rm(tempPath, { force: true });
  }
  return destPath;
}

/** Resolves a stored relative key back to its full path on disk. */
export function artifactPath(episodeId: string, relativeKey: string): string {
  return join(projectsRoot(), episodeId, relativeKey);
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
  return join(projectsRoot(), relativeKey === "warm_natural" ? "lut/warm_film.cube" : relativeKey);
}
