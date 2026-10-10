import { afterEach, beforeEach, expect, test } from "bun:test";
import { close, deleteEpisode, dequeueTask, enqueueTask, insertEpisode,
  listPendingEpisodeDeletions, open } from "@kelvoy/store";
import { deletionEpisodeFixture as fixture } from "./deletion-test-fixture";
import { executeLeasedTask } from "./execution";

beforeEach(() => { open(":memory:"); });
afterEach(() => { close(); });

test.each(["script", "video", "compose"] as const)("%s execution observes deletion and acknowledges only after writer exits", async stage => {
  await insertEpisode(fixture("e_cancel", "u_owner"));
  await enqueueTask({ episode_id: "e_cancel", stage });
  const task = (await dequeueTask())!;
  let aborted = false;
  let exit!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const writer = executeLeasedTask(task, async signal => {
    started();
    await new Promise<void>(resolve => {
      signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
    });
    await new Promise<void>(resolve => { exit = resolve; });
  });
  await ready;
  await deleteEpisode("e_cancel", "u_owner");
  await Bun.sleep(1200);
  expect(aborted).toBe(true);
  expect(await listPendingEpisodeDeletions()).toHaveLength(0);
  exit();
  await writer;
  expect(await listPendingEpisodeDeletions()).toHaveLength(1);
});
