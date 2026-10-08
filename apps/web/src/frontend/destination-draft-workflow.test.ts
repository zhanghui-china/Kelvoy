import { expect, test } from "bun:test";
import { createDraftOperationScope, saveThenMutateDraft } from "./destination-draft-workflow";
import { canEditSharedDestination } from "./destination-draft-form";
test("official destination has no edit access while user is loading", () => {
  expect(canEditSharedDestination(undefined, undefined)).toBe(false);
  expect(canEditSharedDestination(null, "owner")).toBe(false);
  expect(canEditSharedDestination("owner", undefined)).toBe(false);
  expect(canEditSharedDestination("owner", "owner")).toBe(true);
});
test("route change while save is pending prevents mutation and commits", async () => {
  const scope = createDraftOperationScope();
  scope.enter("a");
  const current = scope.capture();
  let resolve!: (value: number) => void;
  const saved = new Promise<number>(done => { resolve = done; });
  const commits: number[] = [];
  const mutations: number[] = [];
  const pending = saveThenMutateDraft(() => saved, value => { commits.push(value); return value; }, async value => { mutations.push(value); }, current);
  scope.enter("b"); resolve(2); await pending;
  expect(commits).toEqual([]); expect(mutations).toEqual([]);
});
test("late mutation cannot commit into new route, even after returning to original ID", async () => {
  const scope = createDraftOperationScope(); scope.enter("a");
  const current = scope.capture();
  let resolve!: () => void;
  const mutation = new Promise<void>(done => { resolve = done; });
  const commits: string[] = [];
  const pending = saveThenMutateDraft(async () => 3, value => value, async (version, active) => { expect(version).toBe(3); await mutation; if (active()) commits.push("a"); }, current);
  await Promise.resolve(); await Promise.resolve();
  scope.enter("b"); scope.enter("a"); resolve(); await pending;
  expect(commits).toEqual([]);
});
