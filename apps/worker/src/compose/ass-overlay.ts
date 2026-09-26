import type { ComposePlan } from "@kelvoy/engine";

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centiseconds / 360000);
  const m = Math.floor(centiseconds / 6000) % 60;
  const s = Math.floor(centiseconds / 100) % 60;
  const cs = centiseconds % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function safeText(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\N").replace(/,/g, "，");
}

export function buildAssOverlay(plan: ComposePlan, introDurationS: number, outroDurationS: number): string {
  const width = plan.res.w;
  const height = plan.res.h;
  const total = introDurationS + plan.cuts.reduce((sum, cut) => sum + cut.duration_s, 0) + outroDurationS;
  const style = (name: string, size: number, alignment: number, marginR: number, marginV: number, box: boolean) =>
    `Style: ${name},Noto Sans CJK SC,${size},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,${box ? 3 : 1},${box ? 1 : 3},0,${alignment},20,${marginR},${marginV},1`;
  const events: string[] = [];
  const add = (start: number, end: number, kind: string, value: string) => {
    if (end > start && value.trim()) events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${kind},,0,0,0,,${safeText(value)}`);
  };
  if (plan.title) add(0, Math.min(total, 2), "Title", plan.title);
  if (plan.ai_label) add(0, total, "Label", plan.ai_label_text);
  if (plan.subtitles_enabled) {
    let at = introDurationS;
    for (const cut of plan.cuts) {
      if (cut.caption) add(at, at + cut.duration_s, "Caption", cut.caption);
      at += cut.duration_s;
    }
  }
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`,
    "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    style("Title", Math.round(width / 17), 8, 20, Math.round(height * 0.12), false),
    style("Caption", Math.round(width / 25), 2, 20, Math.round(height * 0.1), false),
    style("Label", Math.round(width / 30), 3, Math.round(width * 0.045), Math.round(height * 0.04), true),
    "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...events, "",
  ].join("\n");
}
