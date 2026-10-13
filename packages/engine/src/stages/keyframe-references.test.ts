import { expect, test } from "bun:test";
import type { Destination, Persona } from "../schema";
import { keyframeReferences, personaReference } from "./keyframe-references";

const persona = {
  persona_id: "p1", owner_id: "u1", version: 1, name: "角色", desc: "", locked: [], default_outfit: "",
  refs: ["persona/front.png", "persona/side.png", "persona/full.png"], style: { lut: "", title_style: "" },
} as Persona;
const destination = {
  destination_id: "d1", version: 1, name: "灵山", city: "无锡", type: "scenic_area", season_best: [],
  landmarks: [
    { id: "l1", name: "灵山大佛", refs: ["dest/a.jpg", "dest/b.jpg", "dest/c.jpg", "dest/d.jpg"], best_time: "" },
    { id: "l2", name: "无图地标", refs: [], best_time: "" },
  ],
  route: [], food: [], transport: "", stay: "",
} as unknown as Destination;

test("uses the first persona image and the first image of the shot's landmark", () => {
  expect(keyframeReferences(persona, destination, { landmark: "l1" })).toEqual({
    persona: { key: "persona/front.png", index: 0, total: 3, kind: "photo" },
    outfit: null,
    person_omitted: false,
    landmark: { id: "l1", name: "灵山大佛", key: "dest/a.jpg", index: 0, total: 4 },
    landmark_id: "l1",
  });
});

test("a shot without a landmark uses only the persona image", () => {
  const refs = keyframeReferences(persona, destination, { landmark: null });
  expect(refs.persona?.key).toBe("persona/front.png");
  expect(refs.landmark).toBeNull();
  expect(refs.landmark_id).toBeNull();
});

test("a named landmark that is unknown or has no image is distinguishable from no landmark", () => {
  for (const landmark of ["l2", "gone"]) {
    const refs = keyframeReferences(persona, destination, { landmark });
    expect(refs.landmark).toBeNull();
    expect(refs.landmark_id).toBe(landmark);
  }
});

test("missing persona or destination degrade to nulls instead of throwing", () => {
  expect(keyframeReferences(null, null, { landmark: "l1" })).toEqual({ persona: null, outfit: null, landmark: null, landmark_id: "l1", person_omitted: false });
  expect(keyframeReferences({ ...persona, refs: [] }, destination, { landmark: null }).persona).toBeNull();
});

const withOutfits = {
  ...persona,
  outfits: [
    { outfit_id: "o1", name: "秋日风衣", desc: "", seasons: ["秋"], refs: ["persona/o1_a.png", "persona/o1_b.png"] },
    { outfit_id: "o_empty", name: "空", desc: "", seasons: [], refs: [] },
  ],
} as Persona;

test("a chosen outfit's first image replaces the base image, never joins it", () => {
  const refs = keyframeReferences(withOutfits, destination, { landmark: "l1" }, "o1");
  expect(refs.persona).toEqual({ key: "persona/o1_a.png", index: 0, total: 2, kind: "photo" });
  expect(refs.outfit).toEqual({ id: "o1", name: "秋日风衣" });
  expect(refs.landmark?.key).toBe("dest/a.jpg");
});

test("no outfit chosen keeps today's behaviour and outfit is null", () => {
  const refs = keyframeReferences(withOutfits, destination, { landmark: null });
  expect(refs.persona?.key).toBe("persona/front.png");
  expect(refs.outfit).toBeNull();
});

test("an unknown or image-less outfit falls back to the base image", () => {
  for (const id of ["gone", "o_empty"]) {
    const refs = keyframeReferences(withOutfits, destination, { landmark: null }, id);
    expect(refs.persona?.key).toBe("persona/front.png");
    expect(refs.outfit).toBeNull();
  }
});

test("personaReference works without a destination (direct video)", () => {
  expect(personaReference(withOutfits, "o1").ref?.key).toBe("persona/o1_a.png");
  expect(personaReference(null, "o1")).toEqual({ ref: null, outfit: null });
});

test("an empty shot with a landmark image drops the person reference", () => {
  const refs = keyframeReferences(withOutfits, destination, { landmark: "l1", person_visible: false }, "o1");
  expect(refs.persona).toBeNull();
  expect(refs.outfit).toBeNull();
  expect(refs.person_omitted).toBe(true);
  expect(refs.landmark?.key).toBe("dest/a.jpg");
});

test("an empty shot with no usable landmark image keeps the person reference (the workflow needs one image)", () => {
  for (const landmark of [null, "l2", "gone"]) {
    const refs = keyframeReferences(persona, destination, { landmark, person_visible: false });
    expect(refs.person_omitted).toBe(false);
    expect(refs.persona?.key).toBe("persona/front.png");
  }
});

test("person_visible true or missing never omits the person", () => {
  expect(keyframeReferences(persona, destination, { landmark: "l1", person_visible: true }).person_omitted).toBe(false);
  expect(keyframeReferences(persona, destination, { landmark: "l1" }).person_omitted).toBe(false);
});

const views = (sheet: string) => ({ front: `${sheet}_f`, side: `${sheet}_s`, back: `${sheet}_b`, sheet });
const gen = { provider: "local", model: "m", version: "1", seed: 1 };
const withSheets = {
  ...persona,
  views_status: "ready", views: views("persona/default_sheet.jpg"), views_gen: gen,
  outfits: [
    { outfit_id: "o1", name: "秋日风衣", desc: "", seasons: ["秋"], refs: ["outfit/o1.png"], source: "outfit/o1.png",
      views_status: "ready", views: views("outfit/o1_sheet.jpg"), views_gen: gen },
    { outfit_id: "o_src", name: "只有原图", desc: "", seasons: [], refs: [], source: "outfit/src.png",
      views_status: "ready", views: views("outfit/src_sheet.jpg"), views_gen: gen },
    { outfit_id: "o_pending", name: "生成中", desc: "", seasons: [], refs: ["outfit/p.png"], source: "outfit/p.png",
      views_status: "pending" },
    { outfit_id: "o_pending_src", name: "只有原图未就绪", desc: "", seasons: [], refs: [], source: "outfit/ps.png",
      views_status: "failed" },
  ],
} as unknown as Persona;

test("a chosen outfit with a ready sheet uses only that sheet (total 1), not the persona default sheet", () => {
  const refs = keyframeReferences(withSheets, destination, { landmark: "l1" }, "o1");
  expect(refs.persona).toEqual({ key: "outfit/o1_sheet.jpg", index: 0, total: 1, kind: "sheet" });
  expect(refs.outfit).toEqual({ id: "o1", name: "秋日风衣" });
  expect(refs.landmark?.key).toBe("dest/a.jpg");
});

test("a source-only outfit works through its sheet", () => {
  const refs = personaReference(withSheets, "o_src");
  expect(refs.ref?.key).toBe("outfit/src_sheet.jpg");
  expect(refs.outfit?.id).toBe("o_src");
});

test("no outfit chosen uses the persona default sheet", () => {
  const refs = keyframeReferences(withSheets, destination, { landmark: null });
  expect(refs.persona).toEqual({ key: "persona/default_sheet.jpg", index: 0, total: 1, kind: "sheet" });
  expect(refs.outfit).toBeNull();
});

test("an outfit whose views are not ready falls back to its own photo, never the persona sheet", () => {
  const refs = keyframeReferences(withSheets, destination, { landmark: null }, "o_pending");
  expect(refs.persona).toEqual({ key: "outfit/p.png", index: 0, total: 1, kind: "photo" });
  expect(refs.outfit?.id).toBe("o_pending");
});

test("an unknown outfit id or an outfit with neither photo nor sheet falls back to the default (sheet if ready)", () => {
  for (const id of ["gone", "o_pending_src"]) {
    const refs = keyframeReferences(withSheets, destination, { landmark: null }, id);
    expect(refs.persona?.key).toBe("persona/default_sheet.jpg");
    expect(refs.persona?.kind).toBe("sheet");
    expect(refs.outfit).toBeNull();
  }
});

test("old data without views keeps the photo behaviour and is marked photo", () => {
  expect(keyframeReferences(withOutfits, destination, { landmark: null }).persona?.kind).toBe("photo");
  expect(keyframeReferences({ ...withSheets, views_status: "none", views: undefined } as Persona, destination,
    { landmark: null }).persona).toEqual({ key: "persona/front.png", index: 0, total: 3, kind: "photo" });
});

test("an empty shot with a landmark image never sends the sheet either", () => {
  const refs = keyframeReferences(withSheets, destination, { landmark: "l1", person_visible: false }, "o1");
  expect(refs.persona).toBeNull();
  expect(refs.person_omitted).toBe(true);
});
