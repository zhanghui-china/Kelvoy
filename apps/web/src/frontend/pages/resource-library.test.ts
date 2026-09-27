import { expect, test } from "bun:test";
import { filterDestinations, filterTemplates, filterPersonas, availableSelection } from "./resource-library";
import type { Destination, Persona, Template } from "@kelvoy/engine";
const destinations = [
  { destination_id: "legacy", name: "黄山", city: "黄山", type: "mountain_summit", landmarks: [] },
  { destination_id: "new", name: "湖畔", city: "无锡", type: "scenic_area", province: "江苏", country_code: "CN", description: "傍晚漫步", landmarks: [{ name: "古桥" }] },
] as Destination[];
const templates = [
  { template_id: "a", name: "晨间徒步", skeleton: "mountain_summit", owner_id: null },
  { template_id: "b", name: "City Walk", skeleton: "city_night", owner_id: "me" },
] as Template[];

test("destination search combines metadata, landmarks and type with safe legacy fallback", () => {
  expect(filterDestinations(destinations, " 江苏 ", "all").map(d => d.destination_id)).toEqual(["new"]);
  expect(filterDestinations(destinations, "古桥", "scenic_area")).toHaveLength(1);
  expect(filterDestinations(destinations, "傍晚", "mountain_summit")).toEqual([]);
  expect(filterDestinations(destinations, "", "mountain_summit").map(d => d.destination_id)).toEqual(["legacy"]);
  expect(filterDestinations(destinations, "cn", "all")).toHaveLength(1);
});
test("template keyword and skeleton filters intersect", () => {
  expect(filterTemplates(templates, " walk ", "all").map(t => t.template_id)).toEqual(["b"]);
  expect(filterTemplates(templates, "walk", "mountain_summit")).toEqual([]);
  expect(filterTemplates(templates, "", "mountain_summit")).toEqual([templates[0]!]);
});
test("persona source selects only official or owned results", () => {
  const personas = [{ owner_id: null }, { owner_id: "me" }] as Persona[];
  expect(filterPersonas(personas, "official")).toEqual([personas[0]!]);
  expect(filterPersonas(personas, "mine")).toEqual([personas[1]!]);
});
test("resource links only select a currently available catalog ID", () => {
  expect(availableSelection("b", templates.map(t => t.template_id))).toBe("b");
  expect(availableSelection("private-other", templates.map(t => t.template_id))).toBeNull();
  expect(availableSelection(null, [])).toBeNull();
});
