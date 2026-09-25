import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { localImageRequest, localVideoRequest, type StageContext } from "@kelvoy/engine";
import { callInference } from "../inference-client";
import { saveArtifact } from "../storage/artifacts";

type InferenceCall = typeof callInference;

function projectsRoot(): string {
  return resolve(process.env.KELVOY_PROJECTS_ROOT ?? "projects");
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid generation path id");
  return value;
}

async function resolveKey(key: string): Promise<string> {
  if (!key || isAbsolute(key) || key.split(/[\\/]/).includes("..")) {
    throw new Error("invalid artifact path");
  }
  const root = await realpath(projectsRoot());
  const target = await realpath(join(root, key));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("artifact path escapes projects root");
  }
  return target;
}

async function hashKey(key: string): Promise<string> {
  return createHash("sha256").update(await readFile(await resolveKey(key))).digest("hex");
}

async function requestOne(
  call: InferenceCall,
  route: "/image/" | "/video/",
  body: Parameters<InferenceCall>[1],
): Promise<{ source: string; model: string; version: string; seed: number; seconds: number }> {
  const result = await call(route, body);
  if (!result.ok) throw new Error(`local ${route} inference failed: ${JSON.stringify(result.error)}`);
  const response = result.response;
  const expectedPrefix = route === "/image/" ? "inference/image/" : "inference/video/";
  if (response.paths.length !== 1 || !response.paths[0]?.startsWith(expectedPrefix) ||
      !response.model || !response.version || response.seed !== body.seed ||
      !Number.isFinite(response.seconds) || response.seconds < 0) {
    throw new Error("invalid local inference response");
  }
  return { source: await resolveKey(response.paths[0]), model: response.model,
    version: response.version, seed: response.seed, seconds: response.seconds };
}

/** The worker owns all HTTP and filesystem work; engine receives only results. */
export function createLocalGenerationProviders(call: InferenceCall = callInference): Required<Pick<StageContext, "keyframe" | "video">> {
  return {
    keyframe: { async generate(input) {
      safeId(input.episode_id);
      safeId(input.generation_id);
      if (!Number.isInteger(input.candidate_no) || input.candidate_no < 0) throw new Error("invalid candidate index");
      const hashes = await Promise.all(input.refs.map(hashKey));
      const response = await requestOne(call, "/image/", localImageRequest(input));
      const key = `kf/${String(input.shot_no).padStart(2, "0")}_${input.generation_id}_${input.candidate_no}.png`;
      await saveArtifact(input.episode_id, key, response.source);
      return { key, model: response.model, version: response.version,
        seed: response.seed, seconds: response.seconds, ref_hashes: hashes };
    } },
    video: { async generate(input) {
      safeId(input.episode_id);
      safeId(input.generation_id);
      if (!input.keyframe.startsWith("kf/")) throw new Error("invalid keyframe path");
      const frameKey = `${input.episode_id}/${input.keyframe}`;
      const hash = await hashKey(frameKey);
      const response = await requestOne(call, "/video/", localVideoRequest({
        prompt: input.prompt, first_frame: frameKey,
        duration_s: input.duration_s, seed: input.seed,
      }));
      const key = `clip/${String(input.shot_no).padStart(2, "0")}_${input.generation_id}.mp4`;
      await saveArtifact(input.episode_id, key, response.source);
      return { key, model: response.model, version: response.version,
        seed: response.seed, seconds: response.seconds, ref_hashes: [hash] };
    } },
  };
}
