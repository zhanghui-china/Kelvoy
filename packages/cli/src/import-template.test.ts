import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, getTemplate, open } from "@kelvoy/store";
import { importTemplate } from "./import-template";

function validTemplate() {
  return {
    template_id: "t_scenic_area_day",
    owner_id: null,
    name: "大型景区 · 一日",
    skeleton: "scenic_area",
    lut: "lut/warm_film.cube",
    intro: "intro/default.mp4",
    outro: null,
    title_style: "serif-center",
  };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("rejects an invalid template without writing", async () => {
  const result = await importTemplate({ template_id: "t_bad", skeleton: "beach" });
  expect(result.ok).toBe(false);
  expect(result.errors?.length).toBeGreaterThan(0);
  expect(await getTemplate("t_bad")).toBeNull();
});

test("validates then upserts, readable via getTemplate afterwards", async () => {
  const result = await importTemplate(validTemplate());
  expect(result).toEqual({ ok: true, template_id: "t_scenic_area_day" });

  const stored = await getTemplate("t_scenic_area_day");
  expect(stored?.name).toBe("大型景区 · 一日");
  expect(stored?.owner_id).toBeNull();
});

test("importing the same id again overwrites in place", async () => {
  await importTemplate(validTemplate());
  await importTemplate({ ...validTemplate(), name: "改名了" });

  const stored = await getTemplate("t_scenic_area_day");
  expect(stored?.name).toBe("改名了");
});
