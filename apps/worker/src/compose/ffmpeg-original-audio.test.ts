import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposePlan } from "@kelvoy/engine";
import { ffmpegComposeProvider, runCommand } from "./ffmpeg";
import { buildFfmpegArgs, type ComposeInputPaths } from "./ffmpeg-args";

const HAS_FFMPEG = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;
let root: string;

function plan(overrides: Partial<ComposePlan> = {}): ComposePlan {
  return {
    episode_id: "e_oa", output_key: "final/e_oa.mp4",
    cuts: [
      { no: 1, clip_key: "clip/01.mp4", trim_start_s: 0.5, duration_s: 1, trim_start_frame: 15, frame_count: 30 },
      { no: 2, clip_key: "clip/02.mp4", trim_start_s: 0, duration_s: 1, trim_start_frame: 0, frame_count: 30 },
    ],
    music: null, lut_key: null, intro_key: null, outro_key: null, title: "", title_style: "serif-center",
    ai_label: false, ai_label_text: "AI", metadata: {}, res: { w: 180, h: 320 }, fps: 30,
    original_audio_enabled: true, ...overrides,
  };
}

async function clip(path: string, withAudio: boolean, seconds: number): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i", `color=c=blue:s=180x320:r=30:d=${seconds}`,
    ...(withAudio ? ["-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`, "-c:a", "aac"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path];
  const { code, stderr } = await runCommand(cmd);
  if (code !== 0) throw new Error(stderr.slice(-500));
}

async function probe(path: string, stream: "a" | "v"): Promise<number[]> {
  const { stdout } = await runCommand(["ffprobe", "-v", "error", "-select_streams", stream,
    "-show_entries", "stream=duration", "-of", "csv=p=0", path]);
  return stdout.trim().split("\n").filter(Boolean).map(Number);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kelvoy-oa-"));
  process.env.KELVOY_PROJECTS_ROOT = root;
});
afterEach(async () => {
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(root, { recursive: true, force: true });
});

test.skipIf(!HAS_FFMPEG)("original audio is kept, with silence for a clip that has no audio track", async () => {
  await clip(join(root, "e_oa/clip/01.mp4"), true, 3);
  await clip(join(root, "e_oa/clip/02.mp4"), false, 3);
  const { probe: result } = await ffmpegComposeProvider.compose({ plan: plan() });
  const out = join(root, "e_oa/final/e_oa.mp4");
  const [audio] = await probe(out, "a");
  const [video] = await probe(out, "v");
  expect(audio).toBeDefined();
  expect(Math.abs(audio! - video!)).toBeLessThan(0.05);
  expect(result.duration_s).toBeCloseTo(2, 1);
});

test.skipIf(!HAS_FFMPEG)("original audio mixes with music and stays aligned to the picture", async () => {
  await clip(join(root, "e_oa/clip/01.mp4"), true, 3);
  await clip(join(root, "e_oa/clip/02.mp4"), true, 3);
  await mkdir(join(root, "music"), { recursive: true });
  await runCommand(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac",
    join(root, "music/t.m4a")]);
  await ffmpegComposeProvider.compose({ plan: plan({ music: { file_key: "music/t.m4a", bpm: 0, license: "t" } }) });
  const out = join(root, "e_oa/final/e_oa.mp4");
  const [audio] = await probe(out, "a");
  const [video] = await probe(out, "v");
  expect(Math.abs(audio! - video!)).toBeLessThan(0.05);
});

test.skipIf(!HAS_FFMPEG)("without the option the final stays silent", async () => {
  await clip(join(root, "e_oa/clip/01.mp4"), true, 3);
  await clip(join(root, "e_oa/clip/02.mp4"), true, 3);
  await ffmpegComposeProvider.compose({ plan: plan({ original_audio_enabled: undefined }) });
  expect(await probe(join(root, "e_oa/final/e_oa.mp4"), "a")).toEqual([]);
});

const paths = (overrides: Partial<ComposeInputPaths> = {}): ComposeInputPaths => ({
  clips: ["/p/1.mp4", "/p/2.mp4"], intro: null, outro: null, music: null, lut: null, output: "/p/o.mp4",
  font: null, intro_duration_s: 0, outro_duration_s: 0, ...overrides,
});
const graph = (args: string[]) => args[args.indexOf("-filter_complex") + 1]!;

test("argument matrix: original audio × music", () => {
  const original = { clips: [true, false], intro: false, outro: false };
  const only = buildFfmpegArgs(plan(), paths({ original_audio: original }));
  expect(graph(only)).toContain("[vcut0][acut0][vcut1][acut1]concat=n=2:v=1:a=1[vcat][acat]");
  expect(graph(only)).toContain("atrim=0.5:1.5"); // frame window, same source as the video trim
  expect(graph(only)).toContain("anullsrc=r=48000:cl=stereo:d=1[acut1]");
  expect(only[only.indexOf("-map", only.indexOf("-map") + 1) + 1]).toBe("[acat]");
  expect(only).not.toContain("-an");

  const both = buildFfmpegArgs(plan({ music: { file_key: "m", bpm: 0, license: "" } }),
    paths({ music: "/p/m.mp3", original_audio: original }));
  expect(graph(both)).toContain("volume=0.3[amusic];[acat][amusic]amix=inputs=2:duration=first:normalize=0");
  expect(both).toContain("[aout]");

  const none = buildFfmpegArgs(plan({ original_audio_enabled: undefined }), paths());
  expect(none).toContain("-an");
  expect(graph(none)).toContain("a=0[vcat]");
});

test("original audio probe count must match the cuts", () => {
  expect(() => buildFfmpegArgs(plan(), paths({ original_audio: { clips: [true], intro: false, outro: false } })))
    .toThrow("原声探测数量");
});
