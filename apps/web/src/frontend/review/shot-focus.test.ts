import { expect, test } from "bun:test";
import { focusedShot, neighboringShot } from "./shot-focus";

test("focus defaults to first shot and follows an explicit current shot", () => {
  expect(focusedShot([2, 4, 6], null)).toBe(2);
  expect(focusedShot([2, 4, 6], 4)).toBe(4);
  expect(focusedShot([2, 4, 6], 9)).toBe(2);
  expect(focusedShot([], null)).toBeNull();
});

test("neighbor navigation stops at first and last shots", () => {
  expect(neighboringShot([2, 4, 6], 4, -1)).toBe(2);
  expect(neighboringShot([2, 4, 6], 4, 1)).toBe(6);
  expect(neighboringShot([2, 4, 6], 2, -1)).toBeNull();
  expect(neighboringShot([2, 4, 6], 6, 1)).toBeNull();
});
