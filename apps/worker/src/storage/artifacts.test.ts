import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactPath, saveArtifact, sharedAssetPath } from "./artifacts";

test("episode artifact paths reject traversal in ids and keys", () => {
  expect(() => artifactPath("../other", "clip/a.mp4")).toThrow();
  expect(() => artifactPath("e_safe", "../../secret.mp4")).toThrow();
  expect(() => artifactPath("e_safe", "/etc/passwd")).toThrow();
});

test("artifact publication refuses an existing directory symlink outside root", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kelvoy-artifact-"));
  const prior = process.env.KELVOY_PROJECTS_ROOT;
  try {
    mkdirSync(join(temp, "projects", "e_safe"), { recursive: true });
    mkdirSync(join(temp, "outside"));
    symlinkSync(join(temp, "outside"), join(temp, "projects", "e_safe", "clip"));
    writeFileSync(join(temp, "source.mp4"), "video");
    process.env.KELVOY_PROJECTS_ROOT = join(temp, "projects");
    await expect(saveArtifact("e_safe", "clip/a.mp4", join(temp, "source.mp4"))).rejects.toThrow();
  } finally {
    if (prior === undefined) delete process.env.KELVOY_PROJECTS_ROOT;
    else process.env.KELVOY_PROJECTS_ROOT = prior;
    rmSync(temp, { recursive: true, force: true });
  }
});

test("shared asset keys cannot escape projects root", () => {
  expect(() => sharedAssetPath("../../etc/passwd")).toThrow();
  expect(() => sharedAssetPath("/etc/passwd")).toThrow();
  expect(() => sharedAssetPath("music/../secrets.txt")).toThrow();
});

test("shared asset key cannot follow a symlink outside projects root", () => {
  const temp = mkdtempSync(join(tmpdir(), "kelvoy-assets-"));
  const prior = process.env.KELVOY_PROJECTS_ROOT;
  try {
    mkdirSync(join(temp, "projects"));
    writeFileSync(join(temp, "secret.mp3"), "private");
    symlinkSync(temp, join(temp, "projects", "music"));
    process.env.KELVOY_PROJECTS_ROOT = join(temp, "projects");
    expect(() => sharedAssetPath("music/secret.mp3")).toThrow("escapes projects root");
  } finally {
    if (prior === undefined) delete process.env.KELVOY_PROJECTS_ROOT;
    else process.env.KELVOY_PROJECTS_ROOT = prior;
    rmSync(temp, { recursive: true, force: true });
  }
});

test("legacy official LUT name resolves to the packaged shared file", () => {
  expect(sharedAssetPath("warm_natural").endsWith("projects/lut/warm_film.cube")).toBe(true);
  expect(sharedAssetPath("music/city_walk.mp3").endsWith("projects/music/city_walk.mp3")).toBe(true);
});
