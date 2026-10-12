import { expect, test } from "bun:test";
import { validateCreateOutfitRequest, validateOutfitPatchRequest, validatePersona } from "./validate";
import type { Persona } from "./persona";

const outfit = (id: string) => ({ outfit_id: id, name: "秋日风衣", desc: "米色", seasons: ["秋"], refs: ["persona/p/o.png"] });
const persona = (outfits?: unknown): unknown => ({
  persona_id: "c_1", owner_id: "u_1", version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["a", "b", "c"], style: { lut: "x", title_style: "y" }, ...(outfits === undefined ? {} : { outfits }),
});

test("persona without outfits stays valid; with valid outfits passes", () => {
  expect(validatePersona(persona()).valid).toBe(true);
  expect(validatePersona(persona([outfit("o_1"), outfit("o_2")])).valid).toBe(true);
});

test("persona outfits reject duplicates, too many, bad refs and bad shape", () => {
  const dup = validatePersona(persona([outfit("o_1"), outfit("o_1")]));
  expect(!dup.valid && dup.errors.join()).toContain("重复");
  const many = validatePersona(persona(Array.from({ length: 7 }, (_, i) => outfit(`o_${i}`))));
  expect(!many.valid && many.errors.join()).toContain("最多 6 套");
  expect(validatePersona(persona([{ ...outfit("o_1"), refs: [] }])).valid).toBe(false);
  expect(validatePersona(persona([{ ...outfit("o_1"), refs: ["1", "2", "3", "4"] }])).valid).toBe(false);
  expect(validatePersona(persona("nope")).valid).toBe(false);
});

test("create request trims, de-duplicates seasons and requires a name", () => {
  const ok = validateCreateOutfitRequest({ name: " 风衣 ", desc: "", seasons: ["秋", " 秋 ", "冬"] });
  expect(ok.valid && ok.value).toEqual({ name: "风衣", desc: "", seasons: ["秋", "冬"] });
  expect(validateCreateOutfitRequest({ name: "", desc: "", seasons: [] }).valid).toBe(false);
  expect(validateCreateOutfitRequest({ name: "x", desc: "", seasons: [""] }).valid).toBe(false);
});

test("patch only allows name/desc/seasons and needs at least one", () => {
  expect(validateOutfitPatchRequest({ name: "新名" }).valid).toBe(true);
  expect(validateOutfitPatchRequest({}).valid).toBe(false);
  expect(validateOutfitPatchRequest({ refs: ["x"] }).valid).toBe(false);
  expect(validateOutfitPatchRequest({ outfit_id: "o_2" }).valid).toBe(false);
});

test("type: Persona accepts outfits", () => {
  const p: Persona = persona([outfit("o_1")]) as Persona;
  expect(p.outfits?.length).toBe(1);
});
