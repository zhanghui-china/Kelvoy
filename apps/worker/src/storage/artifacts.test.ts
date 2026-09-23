import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactPath, saveArtifact } from "./artifacts";

let tmpRoot: string;
let sourceFile: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "kelvoy-artifacts-"));
  process.env.KELVOY_PROJECTS_ROOT = join(tmpRoot, "projects");
  sourceFile = join(tmpRoot, "source.png");
  await writeFile(sourceFile, "fake-image-bytes");
});

afterEach(async () => {
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(tmpRoot, { recursive: true, force: true });
});

test("saveArtifact copies the file under <root>/<episode_id>/<key>", async () => {
  const dest = await saveArtifact("e_1", "kf/07_a.png", sourceFile);
  expect(dest).toBe(join(tmpRoot, "projects", "e_1", "kf", "07_a.png"));

  const content = await Bun.file(dest).text();
  expect(content).toBe("fake-image-bytes");
});

test("artifactPath resolves without touching disk", () => {
  expect(artifactPath("e_1", "clip/07.mp4")).toBe(join(tmpRoot, "projects", "e_1", "clip", "07.mp4"));
});
