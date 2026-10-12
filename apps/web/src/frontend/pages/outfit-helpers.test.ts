import { expect, test } from "bun:test";
import type { PersonaOutfit } from "@kelvoy/engine";
import { outfitFitsSeason, parseSeasons, sortOutfitsForSeason, suggestedOutfitId } from "./outfit-helpers";

const outfit = (id: string, seasons: string[]): PersonaOutfit => ({ outfit_id: id, name: id, desc: "", seasons, refs: ["a.png"] });
const list = [outfit("summer", ["夏"]), outfit("autumn", ["秋", "冬"]), outfit("none", [])];

test("parseSeasons splits on commas, 顿号 and spaces, trims and de-duplicates", () => {
  expect(parseSeasons("秋、冬, 秋  早春，")).toEqual(["秋", "冬", "早春"]);
  expect(parseSeasons("  ")).toEqual([]);
});

test("season matching is by inclusion either way, never for an empty season", () => {
  expect(outfitFitsSeason(outfit("o", ["春"]), "早春")).toBe(true);
  expect(outfitFitsSeason(outfit("o", ["早春"]), "春")).toBe(true);
  expect(outfitFitsSeason(outfit("o", ["夏"]), "秋")).toBe(false);
  expect(outfitFitsSeason(outfit("o", ["夏"]), "")).toBe(false);
});

test("fitting outfits move first, the rest keep their order", () => {
  expect(sortOutfitsForSeason(list, "秋").map((o) => o.outfit_id)).toEqual(["autumn", "summer", "none"]);
  expect(sortOutfitsForSeason(list, "").map((o) => o.outfit_id)).toEqual(["summer", "autumn", "none"]);
});

test("suggestion is the first fitting outfit, or the default (empty) when none fits", () => {
  expect(suggestedOutfitId(list, "夏")).toBe("summer");
  expect(suggestedOutfitId(list, "冬")).toBe("autumn");
  expect(suggestedOutfitId(list, "春")).toBe("");
  expect(suggestedOutfitId([], "秋")).toBe("");
});
