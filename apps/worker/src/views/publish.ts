import { copyFile, link, mkdir, rm, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { artifactPath } from "../storage/artifacts";

/**
 * Persona assets are shared (not episode-scoped) files under <root>/persona/<persona_id>/.
 * artifactPath("persona", "<id>/...") yields exactly that layout and reuses its traversal/symlink checks;
 * the "persona" segment plays the role of the directory name, not an episode id.
 * Append-only: link() fails with EEXIST instead of replacing an existing file.
 */
export function personaFilePath(key: string): string {
  if (!key.startsWith("persona/")) throw new Error("invalid persona asset key");
  return artifactPath("persona", key.slice("persona/".length));
}

export async function publishPersonaFile(key: string, sourcePath: string): Promise<void> {
  const destination = personaFilePath(key);
  await mkdir(dirname(destination), { recursive: true });
  personaFilePath(key); // mkdir may follow a symlink; recheck the concrete parent
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  try {
    await copyFile(sourcePath, temporary);
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Best-effort removal of files this run published but the store never adopted (and their now-empty directory). */
export async function removePersonaFiles(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => rm(personaFilePath(key), { force: true }).catch(() => undefined)));
  await Promise.all([...new Set(keys.map((key) => dirname(personaFilePath(key))))]
    .map((directory) => rmdir(directory).catch(() => undefined)));
}
