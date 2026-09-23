import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, open } from "./db";
import { completeTask, dequeueTask, enqueueTask, failTask } from "./tasks";

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("dequeueTask returns null when the queue is empty", async () => {
  expect(await dequeueTask()).toBeNull();
});

test("enqueue then dequeue returns the same task, marked processing", async () => {
  const task = await enqueueTask({ episode_id: "e_1", stage: "script" });
  expect(task.attempt).toBe(1);

  const dequeued = await dequeueTask();
  expect(dequeued?.task_id).toBe(task.task_id);
  expect(dequeued?.episode_id).toBe("e_1");
  expect(dequeued?.stage).toBe("script");
});

test("a dequeued task isn't handed out again", async () => {
  await enqueueTask({ episode_id: "e_1", stage: "script" });
  await dequeueTask();
  expect(await dequeueTask()).toBeNull();
});

test("dequeues in FIFO order", async () => {
  const first = await enqueueTask({ episode_id: "e_1", stage: "script" });
  const second = await enqueueTask({ episode_id: "e_2", stage: "script" });

  const a = await dequeueTask();
  const b = await dequeueTask();
  expect(a?.task_id).toBe(first.task_id);
  expect(b?.task_id).toBe(second.task_id);
});

test("failTask with requeue puts the task back as pending with attempt+1", async () => {
  const task = await enqueueTask({ episode_id: "e_1", stage: "keyframe" });
  await dequeueTask();
  await failTask(task.task_id, { requeue: true });

  const retried = await dequeueTask();
  expect(retried?.task_id).toBe(task.task_id);
  expect(retried?.attempt).toBe(2);
});

test("failTask without requeue removes it from the pending pool for good", async () => {
  const task = await enqueueTask({ episode_id: "e_1", stage: "keyframe" });
  await dequeueTask();
  await failTask(task.task_id, { requeue: false });

  expect(await dequeueTask()).toBeNull();
});

test("completeTask removes it from the pending pool", async () => {
  const task = await enqueueTask({ episode_id: "e_1", stage: "compose" });
  await dequeueTask();
  await completeTask(task.task_id);

  expect(await dequeueTask()).toBeNull();
});

test("shot_no is carried through enqueue/dequeue when present", async () => {
  await enqueueTask({ episode_id: "e_1", stage: "keyframe", shot_no: 7 });
  const dequeued = await dequeueTask();
  expect(dequeued?.shot_no).toBe(7);
});
