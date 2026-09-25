/** Compose a completed three-shot technical smoke with generated silent audio. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { close, dequeueTask, enqueueTask, getEpisode, open, patchEpisode, patchShot } from "../../packages/store/src/index";
import { handleTask } from "../../apps/worker/src/queue/consumer";

const dbPath = process.argv[2];
const root = process.env.KELVOY_PROJECTS_ROOT;
if (!dbPath || !root || !process.env.KELVOY_FONT_FILE) {
  throw new Error("usage: KELVOY_PROJECTS_ROOT=... KELVOY_FONT_FILE=... bun run spike/m0/finish_three_shots.ts /tmp/e_three_*.db");
}
const audioKey = "deployment-smoke/synthetic-silence.wav";
const audioPath = join(root, audioKey);
await mkdir(join(root, "deployment-smoke"), { recursive: true });
const ffmpeg = Bun.spawn(["ffmpeg", "-y", "-f", "lavfi", "-i",
  "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", "30", audioPath],
  { stdout: "ignore", stderr: "pipe" });
const stderr = await new Response(ffmpeg.stderr).text();
if (await ffmpeg.exited !== 0) throw new Error(`synthetic audio: ${stderr.slice(-1000)}`);

open(dbPath);
try {
  let current = await getEpisode(dbPath.split("/").pop()!.replace(/\.db$/, ""));
  if (!current.ok) throw new Error("smoke episode missing");
  const id = current.episode.episode_id;
  if (current.episode.status !== "clip_review") throw new Error(`expected clip_review, got ${current.episode.status}`);
  for (const shot of current.episode.shots) {
    if (shot.status !== "clip_ready" || !shot.clip) throw new Error(`shot ${shot.no} not clip_ready`);
    const approved = await patchShot(id, shot.no, current.row_version, { status: "approved" });
    if (!approved.ok) throw new Error(`approve ${shot.no}: ${approved.error}`);
    current = await getEpisode(id);
    if (!current.ok) throw new Error("smoke episode missing");
  }
  const composing = await patchEpisode(id, current.row_version, {
    status: "composing", music: { file: audioKey, bpm: 120, license: "synthetic silence; technical smoke only" },
  });
  if (!composing.ok) throw new Error(`compose transition: ${composing.error}`);
  await enqueueTask({ episode_id: id, stage: "compose" });
  const task = await dequeueTask();
  if (task?.stage !== "compose") throw new Error("compose task missing");
  await handleTask(task);
  const finished = await getEpisode(id);
  if (!finished.ok || finished.episode.status !== "done") throw new Error("compose did not finish");
  const final = join(root, id, "final", `${id}.mp4`);
  if (!(await Bun.file(final).exists())) throw new Error("final mp4 missing");
  console.log(JSON.stringify({ db: dbPath, episode_id: id, status: "done", final }));
} finally {
  close();
}
