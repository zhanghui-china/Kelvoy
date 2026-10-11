import type { Episode } from "@kelvoy/engine";
import type { PromptTraceRow } from "@kelvoy/store";
import type { PromptTraceItem, PromptTraceLegacy } from "../../shared/prompt-traces";

/**
 * ADR-0012 redaction boundary. Store rows are raw (full input_hash, reference
 * storage keys inside user_message); nothing in this file may hand a row, or any
 * field not listed explicitly below, to the response. Redaction fails closed:
 * what cannot be parsed or recognised is replaced, never passed through.
 */

export const UNAVAILABLE = "[unavailable]";
const REFERENCE = "[reference]";
const HASH_PREFIX_LENGTH = 12;
const ROLE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps only role/picture that look like the known enum/ordinal; the storage key is always dropped. */
function redactReference(ref: unknown): Record<string, unknown> {
  if (!isPlainObject(ref)) return { key: REFERENCE };
  const role = typeof ref.role === "string" && ROLE_PATTERN.test(ref.role) ? ref.role : null;
  const picture = typeof ref.picture === "number" && Number.isSafeInteger(ref.picture) && ref.picture >= 0
    && ref.picture < 1000 ? ref.picture : null;
  return {
    key: role !== null && picture !== null ? `[reference: role=${role}, picture=${picture}]` : REFERENCE,
    ...(role !== null ? { role } : {}),
    ...(picture !== null ? { picture } : {}),
  };
}

/**
 * h3_rewrite user_message is JSON.stringify(H3PromptContext). Only references[].key
 * is a known storage path; anything unparsable or structurally unexpected collapses
 * to a fixed placeholder instead of falling back to the original text.
 */
export function redactVideoUserMessage(raw: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return UNAVAILABLE; }
  if (!isPlainObject(parsed)) return UNAVAILABLE;
  if (!("references" in parsed)) return JSON.stringify(parsed);
  if (!Array.isArray(parsed.references)) return UNAVAILABLE;
  return JSON.stringify({ ...parsed, references: parsed.references.map(redactReference) });
}

const LONG_HEX = /[0-9a-f]{32,}/gi;

/**
 * Rejected output is model text, not user input, so it normally holds no storage key. It is still
 * scrubbed against the keys listed in the same row's user_message (the only place they exist) and
 * against long hex runs (content hashes). If those keys cannot be determined the whole text is
 * replaced rather than passed through.
 */
export function redactRejectedOutput(raw: string, userMessage: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(userMessage); } catch { return UNAVAILABLE; }
  if (!isPlainObject(parsed)) return UNAVAILABLE;
  const keys: string[] = [];
  if ("references" in parsed) {
    if (!Array.isArray(parsed.references)) return UNAVAILABLE;
    for (const ref of parsed.references) {
      if (isPlainObject(ref) && typeof ref.key === "string" && ref.key !== "") keys.push(ref.key);
    }
  }
  let text = raw;
  // Longest first so a key that is a prefix of another cannot leave a fragment behind.
  for (const key of keys.sort((a, b) => b.length - a.length)) text = text.split(key).join(REFERENCE);
  return text.replace(LONG_HEX, "[hash]");
}

export function toPromptTraceView(row: PromptTraceRow): PromptTraceItem {
  const video = row.kind === "h3_rewrite";
  return {
    id: String(row.rowid),
    kind: row.kind,
    shot_id: row.shot_id ?? null,
    round: row.round ?? null,
    attempt: row.attempt,
    source: row.source,
    outcome: row.outcome,
    validated: row.outcome === (video ? "ok" : "accepted"),
    rule: row.rule ?? null,
    model: row.model ?? null,
    skill_version: row.skill_version ?? null,
    writer_version: row.writer_version ?? null,
    h3_mode: row.h3_mode ?? null,
    user_message: video ? redactVideoUserMessage(row.user_message) : row.user_message,
    correction_message: row.correction_message ?? null,
    final_prompt: row.final_prompt ?? null,
    rejected_output: video && row.rejected_output != null ? redactRejectedOutput(row.rejected_output, row.user_message) : null,
    input_hash: row.input_hash ? row.input_hash.slice(0, HASH_PREFIX_LENGTH) : null,
    truncated: row.truncated !== 0 || (row.rejected_truncated ?? 0) !== 0,
    created_at: row.created_at,
  };
}

/** Only meaningful on the first page with no records at all (docs/api/prompt-traces.md「legacy」). */
export function legacyNote(
  query: { kind: "script" | "video"; shotId?: string },
  episode: Pick<Episode, "shots">,
): PromptTraceLegacy {
  if (query.kind === "video" && query.shotId !== undefined) {
    const prompt = episode.shots.find((shot) => shot.shot_id === query.shotId)?.model.video?.prompt;
    if (typeof prompt === "string" && prompt !== "") return { note: "final_only", final_prompt: prompt };
  }
  return { note: "not_retained" };
}
