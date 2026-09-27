import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, open } from "./db";
import { dequeueTask, enqueueTask } from "./tasks";

test("worker dequeue waits for a short concurrent SQLite writer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvoy-db-lock-"));
  const path = join(dir, "store.db");
  open(path);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const queued = await enqueueTask({ episode_id: "e_1", stage: "video", shot_no: 1 });
    child = Bun.spawn([process.execPath, "-e", `
      import { Database } from "bun:sqlite";
      const db = new Database(${JSON.stringify(path)});
      db.exec("begin immediate");
      process.stdout.write("LOCKED\\n");
      await Bun.sleep(200);
      db.exec("commit");
      db.close();
    `], { stdout: "pipe", stderr: "pipe" });
    const stdout = child.stdout;
    if (!(stdout instanceof ReadableStream)) throw new Error("missing child stdout");
    const ready = await stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value)).toContain("LOCKED");

    const dequeued = await dequeueTask();
    expect(dequeued?.task_id).toBe(queued.task_id);
    expect(await child.exited).toBe(0);
  } finally {
    close();
    if (child) await child.exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
