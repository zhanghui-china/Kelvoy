/** Run exactly two real model tasks against an isolated database and media root. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { open, close, getDb, insertEpisode, insertPersona, upsertDestination,
  enqueueTask, dequeueTask, renewTaskLease, grantCredits, reserveCredits,
  getCreditAction, getEpisode } from "../../packages/store/src";
import { handleTask } from "../../apps/worker/src/queue/consumer";
import { createH3PromptWriter } from "../../apps/worker/src/generation/h3-prompt-writer";

const fixture = process.env.KELVOY_VIDEO_ACCEPTANCE_ROOT;
if (!fixture || process.env.KELVOY_DB_PATH !== join(fixture, "acceptance.db") ||
    process.env.KELVOY_PROJECTS_ROOT !== join(fixture, "projects")) throw new Error("isolated paths required");
const inputs = JSON.parse(await readFile(join(fixture, "inputs.json"), "utf8"));
open();
getDb().query("insert into users (user_id,username,password_hash) values (?,?,?)")
  .run("u_video_acceptance", "video-acceptance", "disabled-test-login");
await insertPersona(inputs.persona);
await upsertDestination(inputs.destination);
await insertEpisode(inputs.episode);
grantCredits("u_video_acceptance", 10000, "acceptance-grant");
const results = [];
try {
  for (const input of inputs.tasks) {
    const taskId = `tk_acceptance_${input.no}`;
    await enqueueTask({ task_id: taskId, episode_id: inputs.episode.episode_id,
      stage: "video", shot_no: input.no, generation_id: input.generation_id });
    if (!reserveCredits({ action_id: taskId, task_id: taskId, user_id: "u_video_acceptance",
      episode_id: inputs.episode.episode_id, kind: "video", units: 1 }).ok) throw new Error("test reservation failed");
    const task = (await dequeueTask())!;
    if (task.task_id !== taskId) throw new Error("unexpected task; never run unrelated queue work");
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      void renewTaskLease(task.task_id, task.lease_token!).then(active => { if (!active) controller.abort(); })
        .catch(() => controller.abort());
    }, 30000);
    const started = performance.now();
    try {
      await handleTask(task, { signal: controller.signal,
        // Shot 5 must retain its original cached rewrite. Shot 1 left no rewrite,
        // so reproduce the original context through the unchanged writer.
        h3PromptWriter: input.no === 5 ? createH3PromptWriter({ fetch: async () => {
          throw new Error("original H3 cache missing");
        } }) : createH3PromptWriter() });
    } finally { clearInterval(heartbeat); }
    const row = getDb().query("select status,error from tasks where task_id=?").get(taskId) as {status:string;error:string|null};
    const current = await getEpisode(inputs.episode.episode_id);
    if (!current.ok) throw new Error("test episode missing");
    const shot = current.episode.shots.find(s => s.no === input.no)!;
    const result = { shot_no: input.no, task_status: row.status, error: row.error,
      elapsed_seconds: (performance.now() - started) / 1000, seed: shot.model?.video?.seed,
      prompt_hash: shot.model?.video?.prompt ? createHash("sha256").update(shot.model.video.prompt).digest("hex") : null,
      clip: shot.clip, credit_status: getCreditAction(taskId)?.status };
    results.push(result);
    await writeFile(join(fixture, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(result));
    if (row.status !== "done" || !shot.clip || result.credit_status !== "settled") throw new Error(`shot ${input.no} acceptance failed`);
    const probe = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
      "stream=width,height,duration,r_frame_rate:format=duration,size", "-of", "json",
      join(fixture, "projects", current.episode.episode_id, shot.clip)], { stdout: "pipe", stderr: "pipe" });
    const info = JSON.parse(await new Response(probe.stdout).text());
    if (await probe.exited !== 0 || !info.streams?.length || Number(info.format.duration) < 3.8 ||
        info.streams[0].width < 864 || info.streams[0].height < 480) throw new Error("invalid original-quality output");
    await writeFile(join(fixture, `probe-${input.no}.json`), JSON.stringify(info, null, 2));
  }
} finally { close(); }
