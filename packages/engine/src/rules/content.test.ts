import { expect, test } from "bun:test";
import { checkContent, ContentBlockedError } from "./content";

const blocklist = [
  { category: "test", terms: ["敏感词", "bad"] },
];

test("returns empty array when nothing matches", () => {
  const violations = checkContent([{ field: "tone", text: "松弛愉快" }], blocklist);
  expect(violations).toEqual([]);
});

test("catches a single hit", () => {
  const violations = checkContent([{ field: "tone", text: "这里有敏感词" }], blocklist);
  expect(violations).toEqual([{ field: "tone", term: "敏感词", category: "test" }]);
});

test("collects every hit instead of failing fast", () => {
  const violations = checkContent(
    [
      { field: "tone", text: "含敏感词" },
      { field: "banned[0]", text: "也有 bad 内容" },
    ],
    blocklist,
  );
  expect(violations).toHaveLength(2);
  expect(violations.map((v) => v.field)).toEqual(["tone", "banned[0]"]);
});

test("matches case-insensitively and across whitespace", () => {
  const violations = checkContent([{ field: "tone", text: "B A D 情绪" }], blocklist);
  expect(violations).toEqual([{ field: "tone", term: "bad", category: "test" }]);
});

test("accepts a custom blocklist", () => {
  const custom = [{ category: "custom", terms: ["自定义"] }];
  const violations = checkContent([{ field: "tone", text: "自定义禁词" }], custom);
  expect(violations).toEqual([{ field: "tone", term: "自定义", category: "custom" }]);

  // 默认词表里的词，在自定义词表下不该命中
  const notInCustom = checkContent([{ field: "tone", text: "敏感词" }], custom);
  expect(notInCustom).toEqual([]);
});

test("returns empty array on empty input", () => {
  expect(checkContent([], blocklist)).toEqual([]);
  expect(checkContent([{ field: "tone", text: "" }], blocklist)).toEqual([]);
});

test("ContentBlockedError carries the violations", () => {
  const violations = checkContent([{ field: "tone", text: "敏感词" }], blocklist);
  const err = new ContentBlockedError(violations);
  expect(err).toBeInstanceOf(Error);
  expect(err.violations).toEqual(violations);
  expect(err.message).toContain("敏感词");
});
