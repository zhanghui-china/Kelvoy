import { expect, test } from "bun:test";
import type { Destination, Persona } from "../schema";
import { keyframeReferences } from "./keyframe-references";

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
    persona: { key: "persona/front.png", index: 0, total: 3 },
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
  expect(keyframeReferences(null, null, { landmark: "l1" })).toEqual({ persona: null, landmark: null, landmark_id: "l1" });
  expect(keyframeReferences({ ...persona, refs: [] }, destination, { landmark: null }).persona).toBeNull();
});
