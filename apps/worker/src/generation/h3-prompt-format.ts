import type { H3PromptContext } from "@kelvoy/engine";

export const FIRST_FRAME_INSTRUCTION = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
export const BASE_FIELDS = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
export const REF_FIELDS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
export class H3FormatError extends Error {}

function removeNegativeConstraints(text: string): string {
  const term = "(?:(?:spoken|sung|audible|visible)\\s+)?(?:face|mouth|eating|cuts?|dialogue|narration|subtitles?|captions?|on-screen text|lyrics?|vocals?|voices?|singing|speech|spoken words)";
  const list = `\\b(?:no|without)\\s+${term}(?:(?:,\\s*(?:(?:or|and)\\s+)?|\\s+(?:or|and)\\s+)${term})*\\b`;
  return text.replace(new RegExp(list, "gi"), "");
}

export function parseSections(content: string, context: H3PromptContext): Record<string, string> {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new H3FormatError("H3 format: expected JSON object"); }
  const fields = context.mode === "Ref2VA" ? REF_FIELDS : BASE_FIELDS;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== fields.length || fields.some(field =>
      typeof (value as Record<string, unknown>)[field] !== "string" || !(value as Record<string, string>)[field]?.trim())) {
    throw new H3FormatError(`H3 format: expected nonempty strings for ${fields.join(", ")}`);
  }
  return value as Record<string, string>;
}

/** Semantic failures are terminal: a format correction must never repair unsafe content. */
export function validateSections(value: Record<string, string>, context: H3PromptContext): void {
  const all = Object.values(value).join("\n");
  const timeline = value[context.mode === "Ref2VA" ? "detailed_description" : "integrated_multimodal_description"]!;
  // Negative production constraints are allowed; only described actions are checked below.
  const actions = removeNegativeConstraints(timeline);
  const output = removeNegativeConstraints(all);
  const fail = (reason: string): never => { throw new Error(`H3 constraint: ${reason}`); };
  if (/[\u3400-\u9fff]/.test(all)) fail("rewrite must be English");
  if (/\b(?:I (?:see|observe)|I have (?:seen|viewed)|observed in|the (?:reference )?(?:image|picture|photo) shows)\b/i.test(all)) fail("must not claim image observation");
  if (value.non_diegetic_music !== "N/A") fail("background music must be N/A");
  if ((timeline.match(/\[Shot 1\]/g) ?? []).length !== 1 || /\[Shot (?!1\])\d+\]/.test(all)) fail("one continuous Shot 1 required");
  const end = `00:0${context.duration_s}.000`;
  if (!timeline.includes(end)) fail(`timeline must end at ${end}`);
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
  if (context.mode === "Ref2VA") {
    if (context.references.some(ref => !pictures.includes(ref.picture))) fail("all supplied pictures must be referenced");
    const definitions = [...value.subject_definitions!.matchAll(/<Subject (\d+)>\s+(?:is|represents|refers to)/g)].map(match => match[1]);
    const subjects = [...all.matchAll(/<Subject (\d+)>/g)].map(match => match[1]);
    if (!value.summary!.startsWith("[reference generation]")) fail("summary must start with [reference generation]");
    const retention = value.retention_analysis!.trim().split(/\n+/);
    const retained = retention.map(line => line.match(/^<Subject (\d+)> \(appears in \[Shot 1\]\): (fully_preserved|partially_preserved|attribute_transfer|weak_reference) - .+/)?.[1]);
    if (retained.some(n => !n) || definitions.some(n => !retained.includes(n)) || retained.length !== definitions.length) fail("invalid visible retention syntax");
    if (definitions.length !== context.references.length || definitions.some((n, index) => Number(n) !== index + 1)) fail("subject order must match actual pictures");
    for (const ref of context.references) {
      const definition = value.subject_definitions!.match(new RegExp(`<Subject ${ref.picture}>\\s+(?:is|represents|refers to)\\s+[^\\n]*?<Picture (\\d+)>`));
      const definedRole = definition?.[0] ?? "";
      const expectedRole = ref.role === "person" ? /\b(?:person|human|character|woman|man|hands?|identity|appearance)\b/i : /\b(?:scene|environment|location|landscape|setting|background)\b/i;
      if (!expectedRole.test(definedRole)) fail("subject role does not match supplied reference");
      if (Number(definition?.[1]) !== ref.picture) fail("subject mapped to wrong picture");
    }
    if (!definitions.length || subjects.some(n => !definitions.includes(n))) fail("undefined subject reference");
    if (context.references.some(ref => !value.subject_definitions!.includes(`<Picture ${ref.picture}>`))) fail("subject definitions must cite actual sources");
  } else if (/<Subject \d+>/.test(all)) fail("I2VA must use base format");
  if (/<d>|<l>|\(S\d+\)|\b(?:dialogue|speaks?|says?|narration|narrator|captions?|subtitles?|on-screen text|lyrics?|sings?|singing|sung|vocals?|voices?|voice.over|spoken words|speech)\b/i.test(output)) fail("dialogue and text are not requested");
  if (/\b(?:sign|label|banner|screen|poster|notice|billboard|lettering|text)\b[^.\n]*\b(?:reads?|says?|displays?|shows?|spells?|written)\b/i.test(output)) fail("visible text is not requested");
  const sizes: Record<H3PromptContext["size"], RegExp> = {
    wide: /\bwide\b/i, medium: /\bmedium\b/i, close: /\bclose[ -]?up\b/i,
    detail: /\b(?:detail|extreme close[ -]?up)\b/i, pov: /\b(?:POV|point.of.view|first.person)\b/i,
  };
  const cameras: Record<H3PromptContext["camera"], RegExp> = {
    static: /\b(?:static|fixed|locked.off|stationary)\b/i, pan: /\bpan(?:s|ning)?\b/i,
    push: /\b(?:push(?:es|ing)?|dolly|moves? (?:slowly )?forward)\b/i, follow: /\b(?:follow(?:s|ing)?|track(?:s|ing)?)\b/i,
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
}

export function renderSections(value: Record<string, string>, context: H3PromptContext): string {
  const fields = context.mode === "Ref2VA" ? REF_FIELDS : BASE_FIELDS;
  return (context.mode === "I2VA" ? `${FIRST_FRAME_INSTRUCTION}\n\n` : "") +
    fields.map(field => `${field}: ${value[field]}`).join("\n\n");
}
