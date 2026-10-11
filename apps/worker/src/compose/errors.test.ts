import { expect, test } from "bun:test";
import { CompositionError, compositionFailure } from "./errors";

test("asset errors only render validated asset categories and shot numbers", () => {
  expect(new CompositionError("asset_missing", {kind:"music"}).message).toContain("所选配乐素材不可用");
  expect(new CompositionError("asset_missing", {kind:"clip", shotNo:2}).message).toContain("第 2 镜的片段");
  expect(new CompositionError("asset_missing", {kind:"clip", shotNo:NaN}).message).not.toContain("NaN");
  const error = new CompositionError("asset_missing", {kind:"private/path" as "music"});
  expect(compositionFailure(error,0).diagnostic.message).not.toContain("private/path");
});
