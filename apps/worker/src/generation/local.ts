import { createHash } from "node:crypto";
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { localImageRequest, localVideoRequest, type StageContext } from "@kelvoy/engine";
import { callInference } from "../inference-client";
import { artifactPath, saveArtifact } from "../storage/artifacts";

type InferenceCall = typeof callInference;
type CachedAsset = { key: string; model: string; version: string;
  seed: number; seconds: number; ref_hashes: string[] };

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readCached(episodeId: string, key: string, hash: string): Promise<CachedAsset | null> {
  try {
    const meta = JSON.parse(await readFile(`${artifactPath(episodeId, key)}.meta.json`, "utf8")) as
      CachedAsset & { request_hash: string };
    const file = await stat(artifactPath(episodeId, key));
    return meta.request_hash === hash && meta.key === key && file.size > 0 ? meta : null;
  } catch {
    return null;
  }
}

async function saveCached(episodeId: string, key: string, source: string,
  hash: string, asset: CachedAsset): Promise<void> {
  await saveArtifact(episodeId, key, source);
  const path = `${artifactPath(episodeId, key)}.meta.json`;
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify({ ...asset, request_hash: hash }));
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

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
      const key = `kf/${String(input.shot_no).padStart(2, "0")}_${input.generation_id}_${input.candidate_no}.png`;
      const fingerprint = requestHash({ input, hashes });
      const cached = await readCached(input.episode_id, key, fingerprint);
      if (cached) return cached;
      const response = await requestOne(call, "/image/", localImageRequest(input));
      const asset = { key, model: response.model, version: response.version,
        seed: response.seed, seconds: response.seconds, ref_hashes: hashes };
      await saveCached(input.episode_id, key, response.source, fingerprint, asset);
      return asset;
    } },
    video: { async generate(input) {
      safeId(input.episode_id);
      safeId(input.generation_id);
      if (!input.keyframe.startsWith("kf/")) throw new Error("invalid keyframe path");
      const frameKey = `${input.episode_id}/${input.keyframe}`;
      const hash = await hashKey(frameKey);
      const key = `clip/${String(input.shot_no).padStart(2, "0")}_${input.generation_id}.mp4`;
      const fingerprint = requestHash({ input, hash });
      const cached = await readCached(input.episode_id, key, fingerprint);
      if (cached) return cached;
      const response = await requestOne(call, "/video/", localVideoRequest({
        prompt: input.prompt, first_frame: frameKey,
        duration_s: input.duration_s, seed: input.seed, aspect: input.aspect,
      }));
      const asset = { key, model: response.model, version: response.version,
        seed: response.seed, seconds: response.seconds, ref_hashes: [hash] };
      await saveCached(input.episode_id, key, response.source, fingerprint, asset);
      return asset;
    } },
  };
}
