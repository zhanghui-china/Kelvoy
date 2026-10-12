import type { H3PromptContext } from "@kelvoy/engine";

export const FIRST_FRAME_INSTRUCTION = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
export const BASE_FIELDS = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
export const REF_FIELDS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
export class H3FormatError extends Error {
  /**
   * `rule` is a fixed identifier chosen at the throw site, never derived from model output, so it is
   * safe to persist and log. `corrected` is set by the writer once a format correction request ran.
   */
  corrected = false;
  constructor(message: string, public correctable = true, public rule?: string) { super(message); }
}

/**
 * Strips whole negation clauses ("no sound effects, footsteps, or human voices") so the forbidden-term
 * checks in `validateSections` only see affirmative content. A clause starts at `no`/`without` and ends
 * at `.`, `;`, a newline, `|`, or `, but ` / `, while ` / `, then ` / `, and then ` (terminator kept).
 * Commas, `or` and `and` inside the clause are part of the negation. A clause is capped at
 * MAX_NEGATION_WORDS words so a run-on sentence cannot swallow unrelated affirmative content.
 *
 * Trade-off, accepted on purpose: in a mixed clause like "no sound effects, and she says hello"
 * the text after `, and ` is stripped too (until the next terminator). This function only feeds
 * forbidden-term detection, so under-reporting is preferred to false rejections. `, and ` is
 * deliberately NOT a terminator: otherwise "no X, and Y" would leak Y out of the negation.
 */
const MAX_NEGATION_WORDS = 12;
const NEGATION_CLAUSE = /\b(?:no|without)\s+((?:(?!,\s*(?:but|while|then|and\s+then)\s)[^.;\n|])*)/gi;

export function removeNegativeConstraints(text: string): string {
  return text.replace(NEGATION_CLAUSE, (_match, clause: string) => {
    let count = 0;
    for (const word of clause.matchAll(/\S+/g)) {
      if (++count === MAX_NEGATION_WORDS) return clause.slice(word.index + word[0].length);
    }
    return "";
  });
}

export function parseSections(content: string, context: H3PromptContext): Record<string, string> {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new H3FormatError("H3 format: expected JSON object", true, "json_object"); }
  const fields = context.mode === "Ref2VA" ? REF_FIELDS : BASE_FIELDS;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== fields.length || fields.some(field =>
      typeof (value as Record<string, unknown>)[field] !== "string" || !(value as Record<string, string>)[field]?.trim())) {
    throw new H3FormatError(`H3 format: expected nonempty strings for ${fields.join(", ")}`, true, "section_fields");
  }
  return value as Record<string, string>;
}

/**
 * Models sometimes write a reference label without angle brackets ("Picture 1"). That is a pure label
 * syntax slip, so it is rewritten to `<Picture 1>` before validation. Only numbers of supplied
 * pictures are touched; anything else is left for `validateSections` to reject as before. It never
 * changes keys, field count or any non-label text, and a second pass is a no-op.
 */
export function normalizePictureLabels(
  value: Record<string, string>, context: H3PromptContext,
): { sections: Record<string, string>; normalized: number } {
  const provided = new Set(context.references.map(ref => ref.picture));
  let normalized = 0;
  // Not preceded by `<` or a word char; whole number (no "1st", "1.5"); `Picture`/`picture` only, so
  // "pictures" and "Picture perfect" never match. `[ \t]+` keeps the match on one line.
  const bare = /(?<![<\w])[Pp]icture[ \t]+([1-9]\d*)(?![\w>]|\.\d)/g;
  const sections: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    sections[key] = text.replace(bare, (match, digits: string) => {
      if (!provided.has(Number(digits))) return match;
      normalized++;
      return `<Picture ${digits}>`;
    });
  }
  return { sections, normalized };
}

const PERSON_WORDS = /\b(?:person|persona|human|character|woman|man|girl|boy|lady|traveler|traveller|tourist|visitor|protagonist|figure|individual|hands?|identity|appearance)\b/i;
const SCENE_WORDS = /\b(?:scene|scenery|scenic|environment|location|landscape|setting|background|interior|exterior|area|space|place|site|spot|street|view|vista|surroundings|destination|landmark|attraction)\b/i;

const FIRST_FRAME_SOURCE_NOTE = /\(from \[Shot 1\]\)/g;

/**
 * Only pure formatting slips may be sent back to the model for one correction. These three carry no
 * semantic content: a retention line syntax and the `[Shot 1]` marker count. The closing-timestamp rule is
 * correctable only when no timestamp is present, and a real `[Shot N]` with N > 1 is a cut, not a slip; both
 * decisions are made at their check sites.
 */
function isCorrectableRule(reason: string): boolean {
  return reason === "invalid visible retention syntax" || reason === "one continuous Shot 1 required";
}

/** Semantic failures are terminal: a format correction must never repair unsafe content. */
export function validateSections(value: Record<string, string>, context: H3PromptContext): void {
  const all = Object.values(value).join("\n");
  const timeline = value[context.mode === "Ref2VA" ? "detailed_description" : "integrated_multimodal_description"]!;
  // Negative production constraints are allowed; only described actions are checked below.
  const actions = removeNegativeConstraints(timeline);
  const output = removeNegativeConstraints(all);
  const fail = (reason: string, correctable = isCorrectableRule(reason)): never => {
    throw new H3FormatError(`H3 constraint: ${reason}`, correctable, reason);
  };
  if (/[\u3400-\u9fff]/.test(all)) fail("rewrite must be English");
  if (/\b(?:I (?:see|observe)|I have (?:seen|viewed)|observed in|the (?:reference )?(?:image|picture|photo) shows)\b/i.test(all)) fail("must not claim image observation");
  if (value.non_diegetic_music !== "N/A") fail("background music must be N/A");
  // The worker's own first-frame sentence ends "(from [Shot 1])" and models echo it; that is a source annotation,
  // not a second shot, so it is not counted. A real `[Shot 1]` marker or any `[Shot N]` still is.
  const shotMarkers = timeline.replace(FIRST_FRAME_SOURCE_NOTE, "");
  // A real second shot is content (a cut) and stays terminal; only a missing/repeated `[Shot 1]` is a formatting slip.
  if (/\[Shot (?!1\])\d+\]/.test(all)) fail("one continuous Shot 1 required", false);
  if ((shotMarkers.match(/\[Shot 1\]/g) ?? []).length !== 1) fail("one continuous Shot 1 required");
  const end = `00:0${context.duration_s}.000`;
  // Correctable only when the timeline carries no timestamp at all ("for the full 4 seconds"); a wrong timestamp
  // contradicts the requested length and stays terminal.
  if (!timeline.includes(end)) fail(`timeline must end at ${end}`, !/\b\d{2}:\d{2}\.\d{3}\b/.test(timeline));
  if ([...timeline.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/gi)].some(match => Number(match[1]) > context.duration_s)) fail("duration contradicts requested length");
  const totalDurations = [
    ...timeline.matchAll(/\b(?:total (?:duration|length)|(?:clip|video|shot)(?:'s)? (?:duration|length))\s*(?:is|of|:|=)?\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/gi),
    ...timeline.matchAll(/\b(?:clip|video|shot)\s+(?:lasts|runs for|is)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/gi),
  ];
  if (totalDurations.some(match => Number(match[1]) !== context.duration_s)) fail("explicit total duration must match requested length");
  const angles = all.match(/<[^>]*>/g) ?? [];
  if (angles.some(label => !/^<(?:Picture|Subject) [1-9]\d*>$/.test(label))) fail("malformed reference label");
  const timestamps = [...timeline.matchAll(/\b(\d{2}):(\d{2})\.(\d{3})\b/g)];
  if (timestamps.some(match => Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 > context.duration_s)) fail("timeline exceeds duration");
  if (/<(?:Video|Audio) \d+>/.test(all)) fail("unprovided media reference");
  const pictures = [...all.matchAll(/<Picture (\d+)>/g)].map(match => Number(match[1]));
  if (pictures.some(n => !context.references.some(ref => ref.picture === n))) fail("unprovided picture reference");
  let retentionSyntaxInvalid = false;
  if (context.mode === "Ref2VA") {
    // A shot the script marked person_visible=false does not have to cite the person picture: the picture is
    // still supplied (the video model needs two references) but nobody is in frame, so a model that leaves it
    // out is right. Everything else stays strict: the scene picture must be cited, a person Subject must still
    // be defined, and if it does cite a picture that must be Picture 1.
    const optional = (ref: H3PromptContext["references"][number]) => context.person_visible === false && ref.role === "person";
    if (context.references.some(ref => !optional(ref) && !pictures.includes(ref.picture))) fail("all supplied pictures must be referenced");
    const definitions = [...value.subject_definitions!.matchAll(/<Subject (\d+)>\s+(?:is|represents|refers to)/g)].map(match => match[1]);
    const subjects = [...all.matchAll(/<Subject (\d+)>/g)].map(match => match[1]);
    if (!value.summary!.startsWith("[reference generation]")) fail("summary must start with [reference generation]");
    // The product forces a person reference on every shot, so a shot may legitimately contain no person, and the
    // spec has no "not present" wording. The parenthetical is therefore free text (1-80 chars, no brackets/newlines);
    // structure (entry kind, number, relation tag, " - " separator, one Subject entry per definition) stays strict.
    // Picture entries are allowed by the spec and are neither required nor counted.
    const entry = (kind: "Subject" | "Picture", line: string) => line.match(new RegExp(`^<${kind} (\\d+)> \\(([^()\\n]{1,80})\\): (fully_preserved|partially_preserved|attribute_transfer|weak_reference) - .+`))?.[1];
    const retention = value.retention_analysis!.trim().split(/\n+/).filter(line => line.trim());
    const retained: string[] = [];
    let linesValid = retention.length > 0;
    for (const line of retention) {
      const subject = entry("Subject", line);
      if (subject) retained.push(subject);
      else if (!entry("Picture", line)) linesValid = false;
    }
    retentionSyntaxInvalid = !linesValid || new Set(retained).size !== retained.length
      || definitions.some(n => !retained.includes(n)) || retained.length !== definitions.length;
    if (definitions.length !== context.references.length || definitions.some((n, index) => Number(n) !== index + 1)) fail("subject order must match actual pictures");
    for (const ref of context.references) {
      const definition = value.subject_definitions!.match(new RegExp(`<Subject ${ref.picture}>\\s+(?:is|represents|refers to)\\s+[^\\n]*?<Picture (\\d+)>`));
      // Fail only on a clear mismatch: the whole definition line hits one role's vocabulary and none of the other's.
      const line = value.subject_definitions!.match(new RegExp(`<Subject ${ref.picture}>(?:(?!<Subject )[^\\n])*`))?.[0] ?? "";
      const hitsPerson = PERSON_WORDS.test(line), hitsScene = SCENE_WORDS.test(line);
      if (definition && (ref.role === "person" ? hitsScene && !hitsPerson : hitsPerson && !hitsScene)) fail("subject role does not match supplied reference");
      // An optional person Subject that cites no picture at all is fine; one that cites a picture must cite its own.
      // `line` is bounded by the next <Subject, so another subject's label on the same row is not mistaken for it.
      if (!(optional(ref) && !/<Picture \d+>/.test(line)) && Number(definition?.[1]) !== ref.picture) fail("subject mapped to wrong picture");
    }
    if (!definitions.length || subjects.some(n => !definitions.includes(n))) fail("undefined subject reference");
    if (context.references.some(ref => !optional(ref) && !value.subject_definitions!.includes(`<Picture ${ref.picture}>`))) fail("subject definitions must cite actual sources");
  } else if (/<Subject \d+>/.test(all)) fail("I2VA must use base format");
  if (/<d>|<l>|\(S\d+\)|\b(?:dialogue|speaks?|says?|narration|narrator|captions?|subtitles?|on-screen text|lyrics?|sings?|singing|sung|vocals?|voices?|voice.over|spoken words|speech)\b/i.test(output)) fail("dialogue and text are not requested");
  if (/\b(?:sign|label|banner|screen|poster|notice|billboard|lettering|text)\b[^.\n]*\b(?:reads?|says?|displays?|shows?|spells?|written)\b/i.test(output)) fail("visible text is not requested");
  // Script-stage "close" and "detail" are the same near-shot family; models use the two words interchangeably.
  const nearShot = /\b(?:close[ -]?up|closeup|close shot|tight shot|detail|extreme close[ -]?up|macro|insert shot)\b/i;
  const sizes: Record<H3PromptContext["size"], RegExp> = {
    wide: /\b(?:wide|establishing|long shot)\b/i, medium: /\bmedium\b/i, close: nearShot,
    detail: nearShot, pov: /\b(?:POV|point.of.view|first.person)\b/i,
  };
  // The camera enum has no tilt: the script stage folds tilt/sweep/swing into `pan`, so those words count as pan.
  const cameras: Record<H3PromptContext["camera"], RegExp> = {
    static: /\b(?:static|fixed|locked.off|stationary)\b/i,
    pan: /\b(?:pan(?:s|ning)?|tilt(?:s|ing|ed)?|sweep(?:s|ing)?|swing(?:s|ing)?|rotat(?:es|ing)? (?:upward|upwards|downward|downwards|left|right))\b/i,
    push: /\b(?:push(?:es|ing)?|dolly|moves? (?:slowly )?forward|zoom(?:s|ing)? in|approach(?:es|ing)?|moves? closer|closing in)\b/i,
    follow: /\b(?:follow(?:s|ing)?|track(?:s|ing)?|trail(?:s|ing)?|accompan(?:y|ies|ying))\b/i,
  };
  if (!sizes[context.size].test(timeline) || !cameras[context.camera].test(timeline)) fail("preserve shot size and camera");
  if (context.camera === "static" && /\b(?:pan(?:s|ning)?|zoom(?:s|ing)?|dolly|tracking|push.in|camera moves)\b/i.test(actions)) fail("static camera cannot move");
  if (/\b(?:cut to|cuts? away|jump cut|montage|transition to)\b/i.test(actions)) fail("cuts are not allowed");
  if (context.size === "detail" && /烧饼/.test(context.kf_prompt + context.motion_prompt + context.beat)) {
    if (/\b(?:toss(?:es|ing)?|throw(?:s|ing)?|catch(?:es|ing)?|flip(?:s|ping)?|shake(?:s|ing)?|lift(?:s|ing)?|raise(?:s|ing)?|lower(?:s|ing)?|drop(?:s|ping)?|squeez(?:e|es|ing)|break(?:s|ing)?|tear(?:s|ing)?|pull(?:s|ing)?|stretch(?:es|ing)?|crumbl(?:e|es|ing)|reach(?:es|ing)?|bring(?:s|ing)?|wave(?:s|ing)?|tap(?:s|ping)?|grip(?:s|ping)?)\b/i.test(actions)) fail("pastry detail motion is limited to slight wrist rotation");
    if (!/\b(?:only hands?|hands? (?:and|with) (?:the )?(?:pastry|shaobing|flatbread) only)\b/i.test(timeline) || !/\bhands?\b/i.test(timeline) || !/\b(?:pastry|shaobing|flatbread)\b/i.test(timeline) ||
      !/\bwrist\b/i.test(timeline) || !/\b(?:slight|subtle|gentle|small|minimal)\b/i.test(timeline) ||
      !/\b(?:rotat(?:e|es|ing|ion)|turn(?:s|ing)?)\b/i.test(timeline) ||
      /\b(?:face|mouth|eats?|eating|bite|bites|biting)\b/i.test(actions)) fail("pastry detail requires hands and slight wrist rotation only");
  }
  // Semantic violations must remain terminal even when retention formatting is malformed.
  if (retentionSyntaxInvalid) fail("invalid visible retention syntax");
}

export function renderSections(value: Record<string, string>, context: H3PromptContext): string {
  const fields = context.mode === "Ref2VA" ? REF_FIELDS : BASE_FIELDS;
  return (context.mode === "I2VA" ? `${FIRST_FRAME_INSTRUCTION}\n\n` : "") +
    fields.map(field => `${field}: ${value[field]}`).join("\n\n");
}
