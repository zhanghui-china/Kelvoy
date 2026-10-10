import { createHash } from "node:crypto";
import { link, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { localImageRequest, localVideoRequest, type StageContext } from "@kelvoy/engine";
import { callInference } from "../inference-client";
import { artifactPath, saveArtifact } from "../storage/artifacts";

type InferenceCall = typeof callInference;
export interface GenerationBackend {
  comfyui_base_url: string | null;
  config_version: number;
  inference_base_url: string;
  inherited_comfyui_base_url: string | null;
}

export function snapshotGenerationBackend(config: { version: number; comfyui_base_url: string | null }): GenerationBackend {
  return { comfyui_base_url: config.comfyui_base_url, config_version: config.version,
    inference_base_url: process.env.INFERENCE_BASE_URL ?? "http://127.0.0.1:8100",
    inherited_comfyui_base_url: process.env.KELVOY_COMFYUI_BASE_URL ?? null };
}
type CachedAsset = { key: string; model: string; version: string;
  seed: number; seconds: number; ref_hashes: string[] };
type CacheMetadata = CachedAsset & { request_hash: string; content_hash: string };

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readCached(episodeId: string, key: string, hash: string): Promise<CachedAsset | null> {
  try {
    const meta = JSON.parse(await readFile(`${artifactPath(episodeId, key)}.meta.json`, "utf8")) as
      CacheMetadata;
    const path = artifactPath(episodeId, key);
    const file = await stat(path);
    // Older metadata lacks a content digest and cannot be verified for
    // cross-lease reuse. Regenerate it under the new execution key.
    if (meta.request_hash !== hash || meta.key !== key || file.size === 0 || !meta.content_hash) return null;
    const contentHash = createHash("sha256").update(await readFile(path)).digest("hex");
    return contentHash === meta.content_hash ? meta : null;
  } catch {
    return null;
  }
}

async function findCached(episodeId: string, key: string, prefix: string,
  hash: string): Promise<CachedAsset | null> {
  const current = await readCached(episodeId, key, hash);
  if (current) return current;
  const directory = key.split("/", 1)[0]!;
  try {
    for (const name of await readdir(dirname(artifactPath(episodeId, key)))) {
      if (!name.startsWith(prefix) || !name.endsWith(`${key.endsWith(".png") ? ".png" : ".mp4"}.meta.json`)) continue;
      const candidateKey = `${directory}/${name.slice(0, -".meta.json".length)}`;
      const cached = await readCached(episodeId, candidateKey, hash);
      if (cached) return cached;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return null;
}

async function saveCached(episodeId: string, key: string, source: string,
  hash: string, asset: CachedAsset): Promise<void> {
  await saveArtifact(episodeId, key, source);
  const path = `${artifactPath(episodeId, key)}.meta.json`;
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    const content_hash = createHash("sha256").update(await readFile(artifactPath(episodeId, key))).digest("hex");
    await writeFile(temporary, JSON.stringify({ ...asset, request_hash: hash, content_hash }));
    await link(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function publishCached(episodeId: string, source: string, hash: string,
  asset: CachedAsset): Promise<CachedAsset> {
  const extension = asset.key.endsWith(".png") ? ".png" : ".mp4";
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = attempt === 0 ? asset.key
      : `${asset.key.slice(0, -extension.length)}_retry_${crypto.randomUUID()}${extension}`;
    const candidate = { ...asset, key };
    try {
      await saveCached(episodeId, key, source, hash, candidate);
      return candidate;
    } catch (error) {
      // A prior process may have published media but died before metadata, or
      // another writer may have won the metadata link. Never replace either.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not reserve a unique generation artifact key");
}

async function discardInferenceSource(source: string): Promise<void> {
  try {
    await rm(source, { force: true });
  } catch (error) {
    // The immutable episode artifact is already published; cleanup failure
    // must not charge another model attempt. The stale-file sweep handles it.
    console.warn("could not remove archived inference media", source, error);
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
  signal?: AbortSignal,
  backend?: GenerationBackend,
): Promise<{ source: string; model: string; version: string; seed: number; seconds: number }> {
  signal?.throwIfAborted();
  const result = await call(route, backend ? { ...body, comfyui_base_url: backend.comfyui_base_url } : body,
    { signal, ...(backend ? { baseUrl: backend.inference_base_url } : {}) });
  signal?.throwIfAborted();
  if (!result.ok) throw new Error(`local ${route} inference failed: ${JSON.stringify(result.error)}`);
  const response = result.response;
  const expectedPrefix = route === "/image/" ? "inference/image/" : "inference/video/";
  if (response.paths.length !== 1 || !response.paths[0]?.startsWith(expectedPrefix) ||
      !response.model || !response.version || response.seed !== body.seed ||
      !Number.isFinite(response.seconds) || response.seconds < 0) {
    throw new Error("invalid local inference response");
  }
  const source = await resolveKey(response.paths[0]);
  const sourceRelative = relative(await realpath(projectsRoot()), source);
  const sourceDir = route === "/image/" ? `inference${sep}image${sep}` : `inference${sep}video${sep}`;
  if (!sourceRelative.startsWith(sourceDir)) {
    throw new Error("inference media resolves outside its staging directory");
  }
  return { source, model: response.model,
    version: response.version, seed: response.seed, seconds: response.seconds };
}

/** The worker owns all HTTP and filesystem work; engine receives only results. */
export function createLocalGenerationProviders(call: InferenceCall = callInference, configuration?: GenerationBackend): Required<Pick<StageContext, "keyframe" | "video">> {
  const backend = configuration ? { ...configuration } : undefined;
  return {
    keyframe: { async generate(input) {
      input.signal?.throwIfAborted();
      safeId(input.episode_id);
      safeId(input.generation_id);
      const identity = input.shot_id ? safeId(input.shot_id) : String(input.shot_no).padStart(2, "0");
      if (input.execution_id) safeId(input.execution_id);
      if (!Number.isInteger(input.candidate_no) || input.candidate_no < 0) throw new Error("invalid candidate index");
      const hashes = await Promise.all(input.refs.map(hashKey));
      const key = `kf/${identity}_${input.generation_id}${input.execution_id ? `_${input.execution_id}` : ""}_${input.candidate_no}.png`;
      const { signal: _signal, ...requestInput } = input;
      const { execution_id: _executionId, ...reusableInput } = requestInput;
      const fingerprint = requestHash({ input: input.shot_id ? { ...reusableInput, shot_no: undefined } : reusableInput, hashes, backend });
      const cached = await findCached(input.episode_id, key,
        `${identity}_${input.generation_id}_`, fingerprint);
      if (cached) { input.signal?.throwIfAborted(); return cached; }
      const response = await requestOne(call, "/image/", localImageRequest(input), input.signal, backend);
      const asset = { key, model: response.model, version: response.version,
        seed: response.seed, seconds: response.seconds, ref_hashes: hashes };
      try {
        input.signal?.throwIfAborted();
        const published = await publishCached(input.episode_id, response.source, fingerprint, asset);
        input.signal?.throwIfAborted();
        return published;
      } finally {
        await discardInferenceSource(response.source);
      }
    } },
    video: { async generate(input) {
      input.signal?.throwIfAborted();
      safeId(input.episode_id);
      safeId(input.generation_id);
      const identity = input.shot_id ? safeId(input.shot_id) : String(input.shot_no).padStart(2, "0");
      if (input.execution_id) safeId(input.execution_id);
      const direct = input.refs !== undefined;
      if (direct && input.refs?.length !== 2) throw new Error("direct video needs two references");
      if (!direct && !input.keyframe?.startsWith("kf/")) throw new Error("invalid keyframe path");
      const refs = direct ? input.refs! : [`${input.episode_id}/${input.keyframe}`];
      const hashes = await Promise.all(refs.map(hashKey));
      if (input.expected_ref_hashes && (input.expected_ref_hashes.length !== hashes.length ||
        hashes.some((hash, index) => hash !== input.expected_ref_hashes![index]))) {
        throw new Error("video references changed after H3 prompt rewrite");
      }
      const key = `clip/${identity}_${input.generation_id}${input.execution_id ? `_${input.execution_id}` : ""}.mp4`;
      const { signal: _signal, ...requestInput } = input;
      const { execution_id: _executionId, ...reusableInput } = requestInput;
      const fingerprint = requestHash({ input: input.shot_id ? { ...reusableInput, shot_no: undefined } : reusableInput, hashes, backend });
      const cached = await findCached(input.episode_id, key,
        `${identity}_${input.generation_id}_`, fingerprint);
      if (cached) { input.signal?.throwIfAborted(); return cached; }
      const response = await requestOne(call, "/video/", localVideoRequest({
        prompt: input.prompt, refs,
        duration_s: input.duration_s, seed: input.seed, aspect: input.aspect,
      }), input.signal, backend);
      const asset = { key, model: response.model, version: response.version,
        seed: response.seed, seconds: response.seconds, ref_hashes: hashes };
      try {
        input.signal?.throwIfAborted();
        const published = await publishCached(input.episode_id, response.source, fingerprint, asset);
        input.signal?.throwIfAborted();
        return published;
      } finally {
        await discardInferenceSource(response.source);
      }
    } },
  };
}
