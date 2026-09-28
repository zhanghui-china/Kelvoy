import { expect, test } from "bun:test";
import type { Destination, Episode, Shot } from "@kelvoy/engine";
import { buildScriptCsv, downloadScriptCsv, scriptCsvFilename } from "./scriptExport";

const shot = (no: number, beat: string) => ({ no, scene: "scene-1", size: "wide", beat, caption: "你好,\n世界", camera: "static", landmark: "land-1", kf_prompt: '他说"走"', motion_prompt: "向前", duration_s: 1 }) as Shot;
const episode = { name: "旅行/第一集", episode_id: "e1", scenes: [{ id: "scene-1", name: "老街", time: "morning" }], shots: [shot(9, "=SUM(1,2)"), shot(2, "正常动作")] } as Episode;
const destination = { landmarks: [{ id: "land-1", name: "南长街" }] } as Destination;

test("CSV exports current shot order and resolved Chinese labels with safe quoting", () => {
  const csv = buildScriptCsv(episode, destination);
  expect(csv.startsWith("\uFEFF镜号,场景,时段,景别")).toBe(true);
  expect(csv.indexOf("9,老街")).toBeLessThan(csv.indexOf("2,老街"));
  expect(csv).toContain("南长街");
  expect(csv).toContain('"你好,\n世界"');
  expect(csv).toContain('"他说""走"""');
  expect(csv).toContain("'=SUM(1,2)");
});

test("CSV neutralizes formula prefixes after whitespace and filename excludes path characters", () => {
  const csv = buildScriptCsv({ ...episode, shots: [shot(1, "\t@CMD")] } as Episode, null);
  expect(csv).toContain("'\t@CMD");
  expect(scriptCsvFilename(episode)).toBe("旅行_第一集-脚本.csv");
});

test("download clicks a CSV link before releasing its URL after a safe delay", () => {
  const events: string[] = [];
  let cleanup: (() => void) | undefined;
  let blob: Blob | undefined;
  const link = { href: "", download: "", click: () => events.push("click"), remove: () => events.push("remove") };
  const environment = {
    createObjectURL: (value: Blob) => { blob = value; events.push("create"); return "blob:script"; },
    revokeObjectURL: (url: string) => events.push(`revoke:${url}`),
    createLink: () => link,
    append: () => events.push("append"),
    schedule: (callback: () => void, delay: number) => { cleanup = callback; events.push(`schedule:${delay}`); },
  };
  downloadScriptCsv(episode, destination, environment);
  expect(link.href).toBe("blob:script");
  expect(link.download).toBe("旅行_第一集-脚本.csv");
  expect(blob?.type).toBe("text/csv;charset=utf-8");
  expect(events).toEqual(["create", "append", "click", "remove", "schedule:30000"]);
  cleanup?.();
  expect(events.at(-1)).toBe("revoke:blob:script");
});
