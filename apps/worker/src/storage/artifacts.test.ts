import { expect, test } from "bun:test";
import { sharedAssetPath } from "./artifacts";

test("legacy official LUT name resolves to the packaged shared file", () => {
  expect(sharedAssetPath("warm_natural").endsWith("projects/lut/warm_film.cube")).toBe(true);
  expect(sharedAssetPath("music/city_walk.mp3").endsWith("projects/music/city_walk.mp3")).toBe(true);
});
