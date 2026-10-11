/** Node-local verification. Every write is confined to an explicit isolated fixture. */
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { open, close, createUser, createSession, insertEpisode, insertPersona, upsertDestination,
  grantCredits, getCreditBalance, getCreditPrice, enqueueTask, dequeueTask, failTaskWithCredits, getEpisode } from "../../packages/store/src/index";
import type { Episode, Persona, Destination } from "../../packages/engine/src/index";
import { handleTask } from "../../apps/worker/src/queue/consumer";
import { executeLeasedTask } from "../../apps/worker/src/queue/execution";
import { runCommand } from "../../apps/worker/src/compose/ffmpeg";
const root = process.env.KELVOY_COMPOSE_ACCEPTANCE_ROOT;
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
check(root && resolve(process.env.KELVOY_DB_PATH ?? "") === join(resolve(root), "acceptance.db") &&
  resolve(process.env.KELVOY_PROJECTS_ROOT ?? "") === join(resolve(root), "projects"), "explicit isolated paths required");
check(process.env.INFERENCE_BASE_URL === "http://127.0.0.1:1" && process.env.KELVOY_COMFYUI_BASE_URL === "http://127.0.0.1:1" && process.env.STEPFUN_API_BASE === "http://127.0.0.1:1" && !process.env.STEPFUN_API_KEY, "all model providers must be unreachable and uncredentialed");
const database = open();
const mode = process.argv[2];
const stateFile = join(root, "state.json");
if (mode === "init") {
  const inputs = await Bun.file(join(root, "inputs.json")).json() as { episode: Episode; persona: Persona; destination: Destination };
  const user = await createUser({ username: `compose_acceptance_${crypto.randomUUID()}`, password_hash: await Bun.password.hash("acceptance-only") });
  check(user.ok, "isolated account");
  const episode = { ...inputs.episode, owner_id: user.user.user_id };
  await insertPersona({ ...inputs.persona, owner_id: user.user.user_id });
  await upsertDestination(inputs.destination);
  await insertEpisode(episode);
  grantCredits(user.user.user_id, 100, "isolated-compose-acceptance");
  await enqueueTask({ episode_id: episode.episode_id, stage: "compose" });
  const failed = await dequeueTask(); check(failed, "fixture failed task");
  check(failTaskWithCredits(failed, false, "所选配乐素材不可用，请更换配乐或联系管理员。"), "fixture fail transaction");
  const session = await createSession(user.user.user_id);
  await Bun.write(stateFile, JSON.stringify({ id: episode.episode_id, owner: user.user.user_id, username: user.user.username, cookie: `kelvoy_session=${session.session_id}` }));
  console.log("PASS isolated database, account, existing clips and failed compose initialized");
} else if (mode === "verify") {
  const state = await Bun.file(stateFile).json() as { id: string; owner: string; cookie: string };
  const inputs = await Bun.file(join(root, "inputs.json")).json() as { episode: Episode; clip_hashes: Record<string, string> };
  const base = process.env.KELVOY_VERIFY_BASE_URL; check(base?.startsWith("http://127.0.0.1:"), "local HTTP required");
  async function request(path: string, method = "GET", body?: unknown, status = 200) {
    const response = await fetch(base + path, { method, headers: { cookie: state.cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    check(response.status === status, `HTTP ${method}: expected ${status}, got ${response.status}`);
    return response.json();
  }
  const path = `/api/episodes/${state.id}`;
  let current = await request(path);
  check(current.failed_task?.stage === "compose", "compose failure settings available");
  await request(path, "PATCH", { row_version: current.row_version, patch: { music: { ...current.episode.music, enabled: false } } });
  current = await request(path);
  await request(path, "PATCH", { row_version: 1, patch: { music: current.episode.music } }, 409);
  const before = getCreditBalance(state.owner);
  const submitted = await request(path + "/retry", "POST", { row_version: current.row_version });
  check(submitted.stage === "compose", "normal retry only composes");
  await request(path + "/retry", "POST", { row_version: current.row_version }, 409);
  const task = await dequeueTask(); check(task?.stage === "compose", "only compose queued");
  await executeLeasedTask(task, signal => handleTask(task, { signal }));
  current = await request(path);
  check(current.episode.status === "done" && current.episode.failure_reason === null, "composition delivered and error cleared");
  check(current.episode.cut_policy === inputs.episode.cut_policy && JSON.stringify(current.episode.shots) === JSON.stringify(inputs.episode.shots), "shots and cut policy retained");
  check(current.episode.music.enabled === false, "music stays disabled");
  for (const [key, hash] of Object.entries(inputs.clip_hashes)) {
    check(createHash("sha256").update(new Uint8Array(await Bun.file(join(root, "projects", state.id, key)).arrayBuffer())).digest("hex") === hash, "existing clip hash retained");
  }
  const probe = await runCommand(["ffprobe", "-v", "error", "-show_streams", "-of", "json", join(root, "projects", state.id, current.episode.final.key)]);
  check(probe.code === 0, "probe output");
  const streams = JSON.parse(probe.stdout).streams;
  check(!streams.some((stream: { codec_type: string }) => stream.codec_type === "audio"), "output has no audio stream");
  check(current.episode.final.width === 1080 && current.episode.final.height === 1920 && current.episode.final.fps === 30, "delivery dimensions and fps");
  check(database.query("select 1 from tasks where stage != 'compose'").get() === null, "no model tasks");
  check(getCreditBalance(state.owner).available === before.available - getCreditPrice("compose") && getCreditBalance(state.owner).reserved === 0, "normal isolated credit settlement");
  const fileResponse = await fetch(base + path + "/files/" + current.episode.final.key, { headers: { cookie: state.cookie } });
  check(fileResponse.ok, "delivery file accessible");
  await fileResponse.body?.cancel();
  await Bun.write(join(root, "result.json"), JSON.stringify({ status: "passed", clips: Object.keys(inputs.clip_hashes).length, cut_policy: current.episode.cut_policy, final: current.episode.final, audio_streams: 0, model_tasks: 0, credits: getCreditPrice("compose") }, null, 2));
  console.log("PASS real HTTP save/conflict/retry/duplicate; eight clips unchanged, no model tasks, silent 1080x1920 30fps delivery");
} else throw Error("init or verify required");
close();
