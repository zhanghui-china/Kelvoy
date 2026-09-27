import { realpathSync } from "node:fs";
import { join, relative } from "node:path";

/** Reject links below the configured projects root, including links between owners. */
export function staysOnDiskPath(root: string, path: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const realFile = realpathSync(path);
    return realFile === join(realRoot, relative(root, path));
  } catch (error) {
    // A missing file remains a normal 404 at the serving route.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
