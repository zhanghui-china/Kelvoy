import { expect, test } from "bun:test";
import { personaReferenceLabel } from "./persona-reference-label";

test("sheet reference is labelled as the three-view sheet without a page count", () => {
  const label = personaReferenceLabel("小岛", { kind: "sheet", index: 0, total: 1 }, { name: "风衣" });
  expect(label).toBe("角色参考 · 三视图设定图 · 小岛 · 穿搭「风衣」");
});

test("photo reference keeps the index / total suffix", () => {
  expect(personaReferenceLabel("小岛", { kind: "photo", index: 0, total: 3 }, null))
    .toBe("角色参考 · 小岛 · 第 1 张 / 共 3 张");
});
