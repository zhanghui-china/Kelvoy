import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Template } from "@kelvoy/engine";
import { close, open } from "./db";
import { deleteTemplate, getTemplate, listTemplates, upsertTemplate } from "./templates";

function fixture(id: string, ownerId: string | null): Template {
  return {
    template_id: id,
    owner_id: ownerId,
    name: `模板 ${id}`,
    skeleton: "scenic_area",
    lut: "lut/warm_film.cube",
    intro: null,
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

test("returns null for a missing template", async () => {
  expect(await getTemplate("t_missing")).toBeNull();
});

test("round-trips an upserted template", async () => {
  await upsertTemplate(fixture("t_1", null));
  const result = await getTemplate("t_1");
  expect(result?.name).toBe("模板 t_1");
});

test("upserting the same id again overwrites in place", async () => {
  await upsertTemplate(fixture("t_1", null));
  await upsertTemplate({ ...fixture("t_1", null), name: "改名了" });
  const result = await getTemplate("t_1");
  expect(result?.name).toBe("改名了");
});

test("listTemplates with no ownerId returns only official templates", async () => {
  await upsertTemplate(fixture("t_official", null));
  await upsertTemplate(fixture("t_private", "u_1"));

  const result = await listTemplates();
  expect(result.map((t) => t.template_id)).toEqual(["t_official"]);
});

test("listTemplates with an ownerId returns official + that user's own", async () => {
  await upsertTemplate(fixture("t_official", null));
  await upsertTemplate(fixture("t_mine", "u_1"));
  await upsertTemplate(fixture("t_someone_elses", "u_2"));

  const result = await listTemplates("u_1");
  expect(result.map((t) => t.template_id).sort()).toEqual(["t_mine", "t_official"]);
});

test("deleteTemplate removes an owned private template", async () => {
  await upsertTemplate(fixture("t_mine", "u_1"));
  expect(await deleteTemplate("t_mine", "u_1")).toBe(true);
  expect(await getTemplate("t_mine")).toBeNull();
});

test("deleteTemplate refuses to delete an official template", async () => {
  await upsertTemplate(fixture("t_official", null));
  expect(await deleteTemplate("t_official", "u_1")).toBe(false);
  expect(await getTemplate("t_official")).not.toBeNull();
});

test("deleteTemplate refuses to delete someone else's private template", async () => {
  await upsertTemplate(fixture("t_theirs", "u_2"));
  expect(await deleteTemplate("t_theirs", "u_1")).toBe(false);
  expect(await getTemplate("t_theirs")).not.toBeNull();
});

test("deleteTemplate returns false for a missing id", async () => {
  expect(await deleteTemplate("t_missing", "u_1")).toBe(false);
});
