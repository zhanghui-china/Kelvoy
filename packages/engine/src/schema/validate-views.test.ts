import { expect, test } from "bun:test";
import { outfitSheetKey } from "../rules/outfit-sheet";
import type { Persona } from "./persona";
import { validatePersona } from "./validate";

const views = { front: "v/f.png", side: "v/s.png", back: "v/b.png", sheet: "v/sheet.jpg" };
const gen = { provider: "comfyui", model: "qwen-image", version: "2.1", seed: 7 };
const ready = { views, views_status: "ready", views_gen: gen };
const outfit = (extra: Record<string, unknown> = {}) => ({
  outfit_id: "o_1", name: "风衣", desc: "", seasons: ["秋"], refs: [], source: "o/src.png", ...extra,
});
const persona = (extra: Record<string, unknown> = {}, outfits?: unknown[]): Record<string, unknown> => ({
  persona_id: "c_1", owner_id: "u_1", version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["a"], style: { lut: "x", title_style: "y" }, ...(outfits ? { outfits } : {}), ...extra,
});
const errorsOf = (p: unknown): string => {
  const r = validatePersona(p);
  return r.valid ? "" : r.errors.join("\n");
};

test("legacy data without any views fields stays valid", () => {
  expect(validatePersona(persona()).valid).toBe(true);
  expect(validatePersona(persona({}, [{ ...outfit(), source: undefined, refs: ["r.png"] }])).valid).toBe(true);
  expect(validatePersona(persona({ views_status: "none" })).valid).toBe(true);
});

test("ready persona and outfit views pass; pending/failed without views pass", () => {
  expect(validatePersona(persona(ready, [outfit(ready)])).valid).toBe(true);
  expect(validatePersona(persona({ views_status: "pending" }, [outfit({ views_status: "failed" })])).valid).toBe(true);
});

test("ready requires all four keys and a generation record", () => {
  expect(errorsOf(persona({ ...ready, views: { ...views, back: "" } }))).toContain("views.back");
  expect(errorsOf(persona({ ...ready, views: { front: "f" } }))).toContain("views.sheet");
  expect(errorsOf(persona({ views_status: "ready", views_gen: gen }))).toContain("views:");
  expect(errorsOf(persona({ views_status: "ready", views }))).toContain("views_gen");
  expect(errorsOf(persona({ ...ready, views_gen: { ...gen, seed: 1.5 } }))).toContain("views_gen.seed");
  expect(errorsOf(persona({ ...ready, views: { ...views, extra: "x" } }))).toContain("views.extra");
});

test("views and views_gen are rejected unless status is ready", () => {
  expect(errorsOf(persona({ views }))).toContain("仅 views_status 为 ready");
  expect(errorsOf(persona({ views_status: "failed", views_gen: gen }))).toContain("views_gen");
  expect(errorsOf(persona({ views_status: "bogus" }))).toContain("views_status");
});

test("outfit needs source or refs; views need source", () => {
  expect(validatePersona(persona({}, [outfit()])).valid).toBe(true);
  expect(errorsOf(persona({}, [outfit({ source: undefined })]))).toContain("outfits[0].refs");
  expect(errorsOf(persona({}, [outfit({ source: "" })]))).toContain("outfits[0].source");
  expect(errorsOf(persona({}, [outfit({ refs: ["1", "2", "3", "4"] })]))).toContain("outfits[0].refs");
  expect(errorsOf(persona({}, [outfit({ ...ready, source: undefined, refs: ["r"] })]))).toContain("必须有 source");
  expect(errorsOf(persona({}, [outfit({ views_status: "ready" })]))).toContain("outfits[0].views");
});

test("outfitSheetKey returns the sheet only when ready", () => {
  const p = persona(ready, [outfit(ready), outfit({ outfit_id: "o_2", views_status: "pending" }), { ...outfit({ outfit_id: "o_3" }), source: undefined, refs: ["r"] }]) as unknown as Persona;
  expect(outfitSheetKey(p)).toBe("v/sheet.jpg");
  expect(outfitSheetKey(p, null)).toBe("v/sheet.jpg");
  expect(outfitSheetKey(p, "o_1")).toBe("v/sheet.jpg");
  expect(outfitSheetKey(p, "o_2")).toBeNull();
  expect(outfitSheetKey(p, "o_3")).toBeNull();
  expect(outfitSheetKey(p, "missing")).toBeNull();
  expect(outfitSheetKey(persona() as unknown as Persona)).toBeNull();
  expect(outfitSheetKey(null)).toBeNull();
});
