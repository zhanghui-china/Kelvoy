import { expect, test } from "bun:test";
import { runStage } from "./index";
import type { Episode } from "../schema";

test("runStage dispatches to the named stage and rejects as not implemented", async () => {
  await expect(runStage("brief", {} as Episode)).rejects.toThrow("not implemented");
});
