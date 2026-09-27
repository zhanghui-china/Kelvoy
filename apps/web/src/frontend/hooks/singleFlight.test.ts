import { expect, test } from "bun:test";
import { singleFlight } from "./singleFlight";

test("a refresh during a slow poll ignores the stale response and issues one fresh request", async () => {
  const pending: ((value: number) => void)[] = [];
  const received: number[] = [];
  const runner = singleFlight(() => new Promise<number>((resolve) => pending.push(resolve)),
    (value) => received.push(value));
  runner.trigger();
  runner.trigger();
  runner.trigger();
  expect(pending).toHaveLength(1);
  pending[0]!(1);
  await Promise.resolve();
  expect(received).toEqual([]);
  expect(pending).toHaveLength(2);
  pending[1]!(2);
  await Promise.resolve();
  expect(received).toEqual([2]);
  runner.stop();
});

test("navigation stops applying a response that arrives after cleanup", async () => {
  let resolve!: (value: number) => void;
  const received: number[] = [];
  const runner = singleFlight(() => new Promise<number>((done) => { resolve = done; }),
    (value) => received.push(value));
  runner.trigger();
  runner.stop();
  resolve(1);
  await Promise.resolve();
  expect(received).toEqual([]);
});
