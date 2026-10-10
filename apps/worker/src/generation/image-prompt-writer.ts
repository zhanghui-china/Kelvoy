import { createHash } from "node:crypto";
import { readFile, mkdir, link, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { checkContent, ContentBlockedError, type ImagePromptContext, type ImagePromptResult, type ImagePromptWriter, type QwenPromptProvenance } from "@kelvoy/engine";
import { artifactPath, sharedAssetPath } from "../storage/artifacts";

const WRITER_VERSION = "qwen-image-writer-v1";
type Metadata = Pick<QwenPromptProvenance, "official_commit" | "system_prompt_hash" | "model" | "model_revision" | "sampling"> & { writer_version: string };
interface Options {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  baseUrl?: string;
}
function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function moderate(text: string, field: string): void {
  const violations = checkContent([{ field, text }]);
  if (violations.length) throw new ContentBlockedError(violations);
}
function metadata(value: unknown): Metadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid Qwen metadata");
  const entry = value as Metadata;
  if (![entry.official_commit, entry.model_revision].every(item => typeof item === "string" && /^[a-f0-9]{40}$/.test(item)) ||
      typeof entry.system_prompt_hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.system_prompt_hash) ||
      entry.model !== "Qwen/Qwen-Image-2.1-PE-I2I" || typeof entry.writer_version !== "string" || !entry.writer_version.trim() ||
      !entry.sampling || typeof entry.sampling !== "object" || Array.isArray(entry.sampling) || !Object.keys(entry.sampling).length ||
      Object.values(entry.sampling).some(item => !["number", "boolean", "string"].includes(typeof item) || (typeof item === "number" && !Number.isFinite(item)))) throw new Error("invalid Qwen metadata");
  return { official_commit: entry.official_commit, system_prompt_hash: entry.system_prompt_hash,
    model: entry.model, model_revision: entry.model_revision, sampling: entry.sampling,
    writer_version: entry.writer_version };

}
function validatePrompt(value: unknown, context: ImagePromptContext): string {
  if (typeof value !== "string" || !value.trim() || !/[a-zA-Z]/.test(value) || /[\u3400-\u9fff]/.test(value)) throw new Error("Qwen prompt must be nonempty English");
  const tokens = [...value.matchAll(/<image([^>]*)>/gi)];
  if (tokens.some(token => !/^[1-9]\d*$/.test(token[1]!) || Number(token[1]) > context.references.length)) throw new Error("invalid Qwen reference marker");
  // Reject malformed spellings as well as valid-looking out-of-range numbers.
  if (/<\s*image/i.test(value.replace(/<image[1-9]\d*>/g, ""))) throw new Error("invalid Qwen reference marker");
  // Negative production constraints are allowed; only affirmative descriptions are checked.
  const term = "(?:(?:spoken|sung|audible|visible|readable)\\s+)?(?:face|mouth|heads?|torso|body|shoulders?|eating|text|cuts?|dialogue|narration|subtitles?|captions?|on-screen text|lyrics?|vocals?|voices?|singing|speech|spoken words)";
  const list = `\\b(?:no|without)\\s+${term}(?:(?:,\\s*(?:(?:or|and)\\s+)?|\\s+(?:or|and)\\s+)${term})*\\b`;
  const cropPart = "(?:face|mouth|heads?|torso|body|shoulders?)";
  const cropParts = `(?:the\\s+)?${cropPart}(?:(?:,\\s*(?:(?:or|and)\\s+)?|\\s+(?:or|and)\\s+)(?:the\\s+)?${cropPart})*`;
  const affirmative = value.replace(new RegExp(list, "gi"), "")
    .replace(new RegExp(`\\b${cropParts}\\s+(?:(?:is|are)\\s+)?(?:cropped|kept|excluded)\\s+out(?:\\s+of\\s+(?:the\\s+)?(?:frame|image))?\\b`, "gi"), "")
    .replace(new RegExp(`\\b(?:crop|cropped|keep)\\s+out\\s+${cropParts}\\b`, "gi"), "");
  if (/\b(?:subtitles?|captions?|on-screen text|lettering|dialogue|narration)\b/i.test(affirmative) ||
      /\b(?:sign|label|banner|screen|poster|notice|billboard|text)\b[^.\n]*\b(?:reads?|says?|displays?|shows?|spells?|written)\b/i.test(affirmative)) throw new Error("Qwen rewrite added visible text");
  const source = `${context.kf_prompt} ${context.beat}`;
  const handsOnly = /(?:仅|只)(?:拍摄|拍|展示|呈现|显示|露出|有|保留)?(?:角色的|人物的)?(?:手部|手掌|双手|手(?=和|与))|\bonly (?:the |two |both )?hands?\b/i.test(source);
  if (context.size === "detail" && /烧饼/.test(source) && handsOnly) {
    if (/\bnot (?:only|just)\b/i.test(value) || !/\b(?:only (?:the |two |both |<image1>[’']s )?hands?|hands? (?:and|with) (?:the )?(?:pastry|shaobing|flatbread) only)\b/i.test(value) || !/\b(?:pastry|shaobing|flatbread)\b/i.test(value) ||
      /\b(?:face|mouth|heads?|torso|body|shoulders?|portrait|eats?|eating|bite|bites|biting)\b/i.test(affirmative)) throw new Error("Qwen pastry detail must preserve hands-only composition");
    // Preserve explicit source actions; the fixed regression must not invent new ones.
    const requested = source.replace(/(?:不要|不得|不许|禁止|不能|没有|不)[^，。;\n]*/g, "");
    const actions: [RegExp, RegExp][] = [
      [/\b(?:toss(?:es|ing)?|throw(?:s|ing)?)\b/i, /抛|扔|\b(?:toss(?:es|ing)?|throw(?:s|ing)?)\b/i],
      [/\bcatch(?:es|ing)?\b/i, /接住|接起|\bcatch(?:es|ing)?\b/i],
      [/\bflip(?:s|ping)?\b/i, /翻|\bflip(?:s|ping)?\b/i],
      [/\bshake(?:s|ing)?\b/i, /摇|晃|\bshake(?:s|ing)?\b/i],
      [/\b(?:lift(?:s|ing)?|raise(?:s|ing)?)\b/i, /举|抬|拿起|\b(?:lift(?:s|ing)?|raise(?:s|ing)?)\b/i],
      [/\blower(?:s|ing)?\b/i, /放下|降低|\blower(?:s|ing)?\b/i],
      [/\bdrop(?:s|ping)?\b/i, /落|掉|\bdrop(?:s|ping)?\b/i],
      [/\bsqueez(?:e|es|ing)\b/i, /捏|挤|\bsqueez(?:e|es|ing)\b/i],
      [/\b(?:break(?:s|ing)?|tear(?:s|ing)?)\b/i, /掰|撕|\b(?:break(?:s|ing)?|tear(?:s|ing)?)\b/i],
      [/\b(?:pull(?:s|ing)?|stretch(?:es|ing)?)\b/i, /拉|扯|\b(?:pull(?:s|ing)?|stretch(?:es|ing)?)\b/i],
      [/\bcrumbl(?:e|es|ing)\b/i, /碎|\bcrumbl(?:e|es|ing)\b/i],
      [/\breach(?:es|ing)?\b/i, /伸|\breach(?:es|ing)?\b/i],
      [/\bbring(?:s|ing)?\b/i, /带|递|\bbring(?:s|ing)?\b/i],
      [/\bwave(?:s|ing)?\b/i, /挥|摆|\bwave(?:s|ing)?\b/i],
      [/\btap(?:s|ping)?\b/i, /敲|轻点|\btap(?:s|ping)?\b/i],
    ];
    if (actions.some(([generated, original]) => generated.test(affirmative) && !original.test(requested))) throw new Error("Qwen pastry detail added an unrequested action");
  }
  return value;
}
async function publish(episode: string, key: string, value: unknown): Promise<void> {
  const path = artifactPath(episode, key);
  await mkdir(dirname(path), { recursive: true });
  artifactPath(episode, key);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try { await writeFile(temporary, JSON.stringify(value)); await link(temporary, path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  finally { await rm(temporary, { force: true }); }
}

/** Vision model invocation is fail closed. Only parsed answers are persisted. */
export function createImagePromptWriter(options: Options = {}): ImagePromptWriter {
  const call = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? process.env.INFERENCE_BASE_URL ?? "http://127.0.0.1:8100").replace(/\/$/, "");
  return { async write(input) {
    input.signal?.throwIfAborted();
    const context = structuredClone(input.context);
    moderate(JSON.stringify(context), "qwen_input");
    if (context.mode !== "edit" || !["9:16", "16:9"].includes(context.aspect) || !context.kf_prompt.trim()) throw new Error("invalid Qwen input");
    if (context.references.length < 1 || context.references.length > 2 || context.references.some((ref, index) => ref.image !== index + 1 || ref.role !== (index === 0 ? "person" : "scene"))) throw new Error("invalid Qwen reference order");
    const controller = new AbortController();
    const onAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
    // A single budget covers metadata, cache verification and the inference service's one correction.
    const timer = setTimeout(() => controller.abort(new Error("Qwen image prompt rewrite timed out")), options.timeoutMs ?? 900_000);
    const request = async (route: string, body?: unknown): Promise<unknown> => {
      controller.signal.throwIfAborted();
      const response = await call(`${baseUrl}${route}`, { method: body === undefined ? "GET" : "POST", signal: controller.signal,
        redirect: "error", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      controller.signal.throwIfAborted();
      if (!response.ok) throw new Error(`Qwen image rewrite HTTP ${response.status}`);
      const value: unknown = await response.json(); controller.signal.throwIfAborted(); return value;
    };
    try {
      const [official, hashes] = await Promise.all([
        request("/image/rewrite/metadata/").then(metadata),
        Promise.all(context.references.map(async ref => hash(await readFile(sharedAssetPath(ref.key))))),
      ]);
      controller.signal.throwIfAborted();
      const input_hash = hash(JSON.stringify({ context, hashes, official, writer_version: WRITER_VERSION }));
      const key = `image-prompts/${input_hash}.json`;
      const provenance: QwenPromptProvenance = { ...official, writer_version: `${WRITER_VERSION}/${official.writer_version}`, input_hash, ref_hashes: hashes, mode: "edit", aspect: context.aspect };
      const assertReferences = async () => {
        const current = await Promise.all(context.references.map(async ref => hash(await readFile(sharedAssetPath(ref.key)))));
        if (current.some((value, index) => value !== hashes[index])) throw new Error("image references changed during Qwen prompt rewrite");
        controller.signal.throwIfAborted();
      };
      const cached = async (): Promise<ImagePromptResult | null> => {
        let stored: { result?: ImagePromptResult; wh_ratio?: unknown; ratio_follow?: unknown };
        try { stored = JSON.parse(await readFile(artifactPath(input.episode_id, key), "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
        const result = stored?.result;
        if (stored?.wh_ratio !== context.aspect || stored?.ratio_follow !== "" || !result || JSON.stringify(result.provenance) !== JSON.stringify(provenance)) return null;
        moderate(result.prompt, "qwen_output");
        try { validatePrompt(result.prompt, context); } catch { return null; }
        return result;
      };
      const hit = await cached();
      if (hit) { await assertReferences(); return hit; }
      const raw = await request("/image/rewrite/", { context, refs: context.references.map(ref => ref.key), expected_ref_hashes: hashes });
      if (!raw || typeof raw !== "object") throw new Error("invalid Qwen rewrite envelope");
      const response = raw as { prompt?: unknown; wh_ratio?: unknown; ratio_follow?: unknown; reference_hashes?: unknown; metadata?: unknown };
      moderate(typeof response.prompt === "string" ? response.prompt : "", "qwen_output");
      const prompt = validatePrompt(response.prompt, context);
      if (response.wh_ratio !== context.aspect || response.ratio_follow !== "" || JSON.stringify(response.reference_hashes) !== JSON.stringify(hashes)) throw new Error("Qwen rewrite aspect/reference mismatch");
      if (JSON.stringify(metadata(response.metadata)) !== JSON.stringify(official)) throw new Error("Qwen model metadata changed during rewrite");
      await assertReferences();
      const result = { prompt, provenance };
      await publish(input.episode_id, key, { result, wh_ratio: response.wh_ratio, ratio_follow: response.ratio_follow });
      controller.signal.throwIfAborted();
      const published = await cached() ?? result;
      await assertReferences();
      return published;
    } finally { clearTimeout(timer); input.signal?.removeEventListener("abort", onAbort); }
  } };
}
