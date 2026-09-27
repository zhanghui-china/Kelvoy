import { expect, test } from "bun:test";
import { searchHelp } from "./help-search";

test("help search finds existing stage anchors by step text", () => {
  expect(searchHelp("关键帧").some((item) => item.id === "keyframes")).toBe(true);
  expect(searchHelp("256.2")).toEqual([]);
});

test("help search covers resource and FAQ topics and keeps stable anchors", () => {
  expect(searchHelp("官方角色").some((item) => item.id === "personas")).toBe(true);
  expect(searchHelp("横屏").some((item) => item.id === "faq")).toBe(true);
  expect(searchHelp("  积分  ").some((item) => item.id === "credits")).toBe(true);
  expect(searchHelp("").some((item) => item.id === "create")).toBe(true);
  expect(searchHelp("CSV").map((item) => item.id)).toContain("retries");
  expect(searchHelp("PDF").map((item) => item.id)).toContain("retries");
});
