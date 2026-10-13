import { expect, test } from "bun:test";
import { h3ClipSeconds } from "./clip-seconds";

test("H3 clip length is 4 s up to 4 and 5 s beyond", () => {
  expect([3, 4, 4.1, 5, 6].map(h3ClipSeconds)).toEqual([4, 4, 5, 5, 5]);
});
