import { expect, test } from "bun:test";
import { focusWrapIndex } from "./dialog-focus";

test("modal keyboard navigation wraps both boundaries and recovers escaped focus", () => {
  expect(focusWrapIndex(0, 4, true)).toBe(3);
  expect(focusWrapIndex(3, 4, false)).toBe(0);
  expect(focusWrapIndex(1, 4, false)).toBe(null);
  expect(focusWrapIndex(-1, 4, true)).toBe(3);
  expect(focusWrapIndex(-1, 4, false)).toBe(0);
  expect(focusWrapIndex(0, 1, false)).toBe(0);
  expect(focusWrapIndex(-1, 0, false)).toBe(null);
});
