// Replays the stored H3 rewrite contexts of one episode through a writer module and prints pass/fail per shot.
// Usage (on the node, from the release root): bun run spike/orientation/h3_writer_replay.ts <episode_id> <writer-module>
import { Database } from "bun:sqlite";

const [episodeId, modulePath] = process.argv.slice(2);
if (!episodeId || !modulePath) throw new Error("usage: h3_writer_replay.ts <episode_id> <writer-module>");
const { createH3PromptWriter } = await import(modulePath);
const db = new Database(process.env.KELVOY_DB_PATH!, { readonly: true });
const rows = db.query<{ shot_id: string; user_message: string }, [string]>(
  "select shot_id, user_message from prompt_traces where episode_id = ? and kind = 'h3_rewrite' order by rowid",
).all(episodeId);
const byShot = new Map<string, unknown>();
for (const row of rows) if (!byShot.has(row.shot_id)) byShot.set(row.shot_id, JSON.parse(row.user_message));
const writer = createH3PromptWriter();
let ok = 0;
for (const [shotId, context] of byShot) {
  try {
    await writer.write({ episode_id: episodeId, context: context as never });
    ok++;
    console.log(shotId.slice(-4), "ok");
  } catch (error) {
    console.log(shotId.slice(-4), "FAIL", (error as Error).message.slice(0, 120));
  }
}
console.log(`ok ${ok}/${byShot.size}`);
