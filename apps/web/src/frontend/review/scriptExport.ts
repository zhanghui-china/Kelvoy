import type { Destination, Episode } from "@kelvoy/engine";
import { SCENE_TIME_LABELS, SHOT_CAMERA_LABELS, SHOT_SIZE_LABELS } from "../labels";

function csvCell(value: string | number): string {
  let text = String(value);
  // Spreadsheet apps interpret these prefixes as formulas, even after whitespace.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildScriptCsv(episode: Episode, destination: Destination | null): string {
  const rows: (string | number)[][] = [
    ["镜号", "场景", "时段", "景别", "动作 beat", "字幕", "机位", "地标", "关键帧 prompt", "运动 prompt", "目标时长（秒）"],
    ...episode.shots.map((shot) => {
      const scene = episode.scenes.find((item) => item.id === shot.scene);
      const landmark = destination?.landmarks.find((item) => item.id === shot.landmark);
      return [shot.no, scene?.name ?? shot.scene, scene ? SCENE_TIME_LABELS[scene.time] : "", SHOT_SIZE_LABELS[shot.size], shot.beat, shot.caption ?? "", SHOT_CAMERA_LABELS[shot.camera], shot.landmark === null ? "" : landmark?.name ?? shot.landmark, shot.kf_prompt, shot.motion_prompt, shot.duration_s];
    }),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function scriptCsvFilename(episode: Episode): string {
  const safeName = episode.name.replace(/[\\/:*?"<>|\x00-\x1F\x7F]/gu, "_").replace(/^[.\s_]+|[.\s_]+$/gu, "").slice(0, 80);
  return `${safeName || "脚本"}-脚本.csv`;
}
