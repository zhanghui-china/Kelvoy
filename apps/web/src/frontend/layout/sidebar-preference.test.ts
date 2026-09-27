import { expect, test } from "bun:test";
import { readCollapsed, saveCollapsed } from "./sidebar-preference";

test("sidebar preference survives reload and unavailable browser storage", () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
  expect(readCollapsed(() => storage)).toBe(false);
  saveCollapsed(true, () => storage);
  expect(readCollapsed(() => storage)).toBe(true);
  saveCollapsed(false, () => storage);
  expect(readCollapsed(() => storage)).toBe(false);
  const unavailable = () => { throw new Error("SecurityError"); };
  expect(readCollapsed(unavailable)).toBe(false);
  expect(() => saveCollapsed(true, unavailable)).not.toThrow();
});
