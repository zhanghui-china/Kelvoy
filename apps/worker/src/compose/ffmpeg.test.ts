import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposePlan } from "@kelvoy/engine";
import { ffmpegComposeProvider } from "./ffmpeg";

/**
 * 端到端跑一次真实 ffmpeg（M1-13 验收：成片时长 = Σ 单镜实际时长 + 片头片尾
 * ± 0.5 s，元数据里能读到隐式 AI 标识）。CI 上不一定装了 ffmpeg，所以整组
 * 用 skipIf 跳过而不是失败。
 *
 * 不测 drawtext：那要求 ffmpeg 构建时带 libfreetype（homebrew 的默认 bottle
 * 就没有），画面水印的参数拼装由 ffmpeg-args.test.ts 覆盖。
 */
const HAS_FFMPEG = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

let projectsRoot: string;

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`${cmd[0]} failed: ${stderr.slice(-800)}`);
}

async function makeColorClip(path: string, color: string, seconds: number): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await run([
    "ffmpeg", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=180x320:r=30:d=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ]);
}

async function probeDuration(path: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return Number(out.trim());
}

async function probeFrames(path: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return Number(out.trim());
}

async function probeTag(path: string, tag: string): Promise<string> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", `format_tags=${tag}`, "-of", "default=nw=1:nk=1", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return out.trim();
}

function planFixture(): ComposePlan {
  return {
    episode_id: "e_it",
    output_key: "final/e_it.mp4",
    cuts: [
      { no: 1, clip_key: "clip/01.mp4", trim_start_s: 0, duration_s: 1 },
      { no: 2, clip_key: "clip/02.mp4", trim_start_s: 0.5, duration_s: 1.5 },
    ],
    music: { file_key: "music/test.m4a", bpm: 120, license: "test" },
    lut_key: "lut/identity.cube",
    intro_key: "intro/test.mp4",
    outro_key: null,
    title: "",
    title_style: "serif-center",
    ai_label: false,
    ai_label_text: "AI 生成 · 虚构角色 · 真实目的地",
    metadata: {
      comment: "AI 生成 · 虚构角色 · 真实目的地",
      ai_generated: "true",
      kelvoy_episode_id: "e_it",
    },
    res: { w: 180, h: 320 },
    fps: 30,
  };
}

beforeEach(async () => {
  projectsRoot = await mkdtemp(join(tmpdir(), "kelvoy-compose-"));
  process.env.KELVOY_PROJECTS_ROOT = projectsRoot;
  if (!HAS_FFMPEG) return;

  await makeColorClip(join(projectsRoot, "e_it", "clip", "01.mp4"), "blue", 3);
  await makeColorClip(join(projectsRoot, "e_it", "clip", "02.mp4"), "red", 3);
  await makeColorClip(join(projectsRoot, "intro", "test.mp4"), "green", 1);
  await mkdir(join(projectsRoot, "music"), { recursive: true });
  await run([
    "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:a", "aac", join(projectsRoot, "music", "test.m4a"),
  ]);
  await mkdir(join(projectsRoot, "lut"), { recursive: true });
  // 恒等 3D LUT（2×2×2，红色分量变化最快）——只为验证 lut3d=file= 这条参数
  // 真的被 ffmpeg 接受，不改变画面。
  await writeFile(
    join(projectsRoot, "lut", "identity.cube"),
    "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
  );
});

afterEach(async () => {
  delete process.env.KELVOY_PROJECTS_ROOT;
  await rm(projectsRoot, { recursive: true, force: true });
});

test.skipIf(!HAS_FFMPEG)("ffmpegComposeProvider renders final/<id>.mp4 at Σcuts + intro ± 0.5 s", async () => {
  const result = await ffmpegComposeProvider.compose({ plan: planFixture() });
  expect(result.output_key).toBe("final/e_it.mp4");
  expect(result.probe.width).toBe(180);
  expect(result.probe.height).toBe(320);
  expect(result.probe.fps).toBe(30);
  expect(result.probe.size_bytes).toBeGreaterThan(0);

  const output = join(projectsRoot, "e_it", "final", "e_it.mp4");
  expect(await Bun.file(output).exists()).toBe(true);

  // 片头 1 s + 1 s + 1.5 s = 3.5 s
  expect(Math.abs((await probeDuration(output)) - 3.5)).toBeLessThanOrEqual(0.5);
});

test.skipIf(!HAS_FFMPEG)("ffmpegComposeProvider writes the implicit AI-label metadata (PRD §8)", async () => {
  await ffmpegComposeProvider.compose({ plan: planFixture() });
  const output = join(projectsRoot, "e_it", "final", "e_it.mp4");

  expect(await probeTag(output, "comment")).toBe("AI 生成 · 虚构角色 · 真实目的地");
  expect(await probeTag(output, "ai_generated")).toBe("true");
  expect(await probeTag(output, "kelvoy_episode_id")).toBe("e_it");
  // provider 身份（CLAUDE.md：每个 provider 记录自己是谁）。
  expect(await probeTag(output, "kelvoy_compose")).toBe("ffmpeg");
  expect(await probeTag(output, "encoder_note")).toContain("ffmpeg version");
});

test.skipIf(!HAS_FFMPEG)("ffmpegComposeProvider names the missing asset instead of failing inside ffmpeg", async () => {
  const plan = planFixture();
  plan.cuts[1]!.clip_key = "clip/99.mp4";
  await expect(ffmpegComposeProvider.compose({ plan })).rejects.toThrow("合成缺少第 2 镜的片段");

  const noMusic = planFixture();
  noMusic.music = { file_key: "music/nope.m4a", bpm: 120, license: "test" };
  await expect(ffmpegComposeProvider.compose({ plan: noMusic })).rejects.toThrow("合成缺少配乐文件");
});

test.skipIf(!HAS_FFMPEG)("fixed cuts render exactly 30 frames per shot and reject tail overrun", async () => {
  const plan = planFixture();
  plan.cuts = [
    { no: 1, clip_key: "clip/01.mp4", trim_start_s: 2 / 30, duration_s: 1, trim_start_frame: 2, frame_count: 30 },
    { no: 2, clip_key: "clip/02.mp4", trim_start_s: 0, duration_s: 1, trim_start_frame: 0, frame_count: 30 },
  ];
  plan.intro_key = null;
  plan.outro_key = null;
  plan.music = null;
  plan.lut_key = null;
  await ffmpegComposeProvider.compose({ plan });
  const output = join(projectsRoot, "e_it", "final", "e_it.mp4");
  expect(await probeFrames(output)).toBe(60);
  expect(await probeDuration(output)).toBeCloseTo(2, 2);

  plan.cuts[0] = { ...plan.cuts[0]!, trim_start_s: 75 / 30, trim_start_frame: 75 };
  await expect(ffmpegComposeProvider.compose({ plan })).rejects.toThrow("选段超出片段尾部");
});
