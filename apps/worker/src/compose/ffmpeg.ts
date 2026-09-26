import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ComposePlan, ComposeProvider } from "@kelvoy/engine";
import { artifactPath, sharedAssetPath } from "../storage/artifacts";
import { buildFfmpegArgs, type ComposeInputPaths } from "./ffmpeg-args";
import { buildAssOverlay, textOverlayEvents } from "./ass-overlay";

/**
 * 合成 provider（PRD §9, M1-13）：整个系统里唯一调用 ffmpeg 的地方，只在
 * worker 上跑。engine 出 ComposePlan（相对 key + 秒数），这里负责解析绝对
 * 路径、检查素材存在、探测片头片尾时长，再执行一条 ffmpeg 命令。
 *
 * 没有模型 seed/cost 可记（不是生成，是剪辑），按 CLAUDE.md "每个 provider
 * 记录 provider/model/version" 的要求，把后端身份和 ffmpeg 版本写进成片元数据。
 */

// 出错时带回的 stderr 尾部长度：够定位 filtergraph 报错，又不会把整段日志灌进
// tasks 表。ffmpeg 的 stderr 不含密钥。
const STDERR_TAIL_CHARS = 2000;

async function requireFile(path: string, what: string): Promise<string> {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`合成缺少${what}：${path}`);
  }
  return path;
}

async function runCommand(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** 片头片尾的时长是素材属性，engine 量不到——这里用 ffprobe 读。 */
async function probeDurationS(path: string): Promise<number> {
  const { code, stdout, stderr } = await runCommand([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number(stdout.trim());
  if (code !== 0 || !Number.isFinite(seconds)) {
    throw new Error(`ffprobe 读不出时长：${path}\n${stderr.trim().slice(-STDERR_TAIL_CHARS)}`);
  }
  return seconds;
}

async function probeVideoDurationS(path: string): Promise<number> {
  const { code, stdout, stderr } = await runCommand([
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
  ]);
  const seconds = Number(stdout.trim());
  if (code !== 0 || !Number.isFinite(seconds)) {
    throw new Error(`ffprobe 读不出视频时长：${path}\n${stderr.trim().slice(-STDERR_TAIL_CHARS)}`);
  }
  return seconds;
}

async function probeOutput(path: string): Promise<{
  duration_s: number; width: number; height: number; fps: number; size_bytes: number;
}> {
  const { code, stdout, stderr } = await runCommand([
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate:format=duration,size", "-of", "json", path,
  ]);
  if (code !== 0) throw new Error(`ffprobe 验证成片失败：${stderr.slice(-STDERR_TAIL_CHARS)}`);
  const data = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; avg_frame_rate?: string }[];
    format?: { duration?: string; size?: string };
  };
  const stream = data.streams?.[0];
  const [numerator, denominator] = (stream?.avg_frame_rate ?? "").split("/").map(Number);
  const fps = denominator ? numerator! / denominator : Number(stream?.avg_frame_rate);
  const duration = Number(data.format?.duration);
  const size = Number(data.format?.size);
  if (!stream?.width || !stream.height || !Number.isFinite(fps) || fps <= 0 ||
      !Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error("ffprobe 返回了无效的成片参数");
  }
  return { duration_s: duration, width: stream.width, height: stream.height,
    fps, size_bytes: size };
}

async function ffmpegVersionLine(): Promise<string> {
  const { code, stdout } = await runCommand(["ffmpeg", "-version"]);
  if (code !== 0) return "ffmpeg";
  return stdout.split("\n")[0]?.trim() ?? "ffmpeg";
}

async function supportsAssFilter(): Promise<boolean> {
  const { code, stdout } = await runCommand(["ffmpeg", "-hide_banner", "-filters"]);
  return code === 0 && /^\s*[.A-Z|]+\s+ass\s+/m.test(stdout);
}

async function supportsDrawtextFilter(): Promise<boolean> {
  const { code, stdout } = await runCommand(["ffmpeg", "-hide_banner", "-filters"]);
  return code === 0 && /^\s*[.A-Z|]+\s+drawtext\s+/m.test(stdout);
}

async function renderPngOverlays(plan: ComposePlan, paths: ComposeInputPaths): Promise<void> {
  const events = textOverlayEvents(plan, paths.intro_duration_s, paths.outro_duration_s);
  if (!events.length) return;
  const overlayImages = events.map((event, index) => ({
    ...event,
    path: `${paths.output}.overlay-${index}.png`,
  }));
  const manifestPath = `${paths.output}.overlay.json`;
  await writeFile(manifestPath, JSON.stringify({ width: plan.res.w, height: plan.res.h, events: overlayImages }));
  const script = resolve(import.meta.dir, "../../../../scripts/render-text-overlays.py");
  const { code, stderr } = await runCommand(["python3", script, manifestPath]);
  if (code !== 0) {
    throw new Error(`无法绘制成片文字图层：${stderr.trim().slice(-STDERR_TAIL_CHARS)}`);
  }
  paths.overlay_images = overlayImages;
}

async function resolvePaths(plan: ComposePlan): Promise<ComposeInputPaths> {
  const clips = await Promise.all(
    plan.cuts.map((cut) => requireFile(artifactPath(plan.episode_id, cut.clip_key), `第 ${cut.no} 镜的片段`)),
  );
  for (const [index, cut] of plan.cuts.entries()) {
    if (cut.frame_count === undefined) continue;
    const duration = await probeVideoDurationS(clips[index]!);
    if (cut.trim_start_s + cut.duration_s > duration + 1e-6) {
      throw new Error(`第 ${cut.no} 镜选段超出片段尾部：需要 ${cut.trim_start_s + cut.duration_s} 秒，实际 ${duration} 秒`);
    }
  }

  // 跨期共享素材（曲库、LUT、片头片尾）挂在 projects 根下，不在期目录里。
  const intro = plan.intro_key !== null ? await requireFile(sharedAssetPath(plan.intro_key), "片头") : null;
  const outro = plan.outro_key !== null ? await requireFile(sharedAssetPath(plan.outro_key), "片尾") : null;
  const music =
    plan.music !== null ? await requireFile(sharedAssetPath(plan.music.file_key), "配乐文件") : null;
  const lut = plan.lut_key !== null ? await requireFile(sharedAssetPath(plan.lut_key), "LUT 文件") : null;

  const fontEnv = process.env.KELVOY_FONT_FILE;
  const font = fontEnv ? await requireFile(fontEnv, "字体文件（KELVOY_FONT_FILE）") : null;

  return {
    clips,
    intro,
    outro,
    music,
    lut,
    output: artifactPath(plan.episode_id, plan.output_key),
    font,
    intro_duration_s: intro !== null ? await probeDurationS(intro) : 0,
    outro_duration_s: outro !== null ? await probeDurationS(outro) : 0,
  };
}

export const ffmpegComposeProvider: ComposeProvider = {
  async compose({ plan }) {
    const paths = await resolvePaths(plan);
    await mkdir(dirname(paths.output), { recursive: true });
    const needsText = Boolean(plan.title) || plan.ai_label ||
      (plan.subtitles_enabled && plan.cuts.some((cut) => Boolean(cut.caption)));
    if (needsText && await supportsAssFilter()) {
      const overlayPath = `${paths.output}.ass`;
      const tempPath = `${overlayPath}.tmp-${crypto.randomUUID()}`;
      try {
        await writeFile(tempPath, buildAssOverlay(plan, paths.intro_duration_s, paths.outro_duration_s));
        await rename(tempPath, overlayPath);
      } finally {
        await rm(tempPath, { force: true });
      }
      paths.overlay_ass = overlayPath;
    } else if (needsText && !(paths.font && await supportsDrawtextFilter())) {
      await renderPngOverlays(plan, paths);
    }

    const stamped: ComposePlan = {
      ...plan,
      metadata: {
        ...plan.metadata,
        kelvoy_compose: "ffmpeg",
        encoder_note: await ffmpegVersionLine(),
      },
    };

    const args = buildFfmpegArgs(stamped, paths);
    const { code, stderr } = await runCommand(["ffmpeg", ...args]);
    if (code !== 0) {
      throw new Error(`ffmpeg 合成失败（退出码 ${code}）：\n${stderr.trim().slice(-STDERR_TAIL_CHARS)}`);
    }
    const probe = await probeOutput(paths.output);
    if (probe.width !== plan.res.w || probe.height !== plan.res.h || Math.abs(probe.fps - plan.fps) > 0.01) {
      throw new Error(`成片参数不匹配：${probe.width}x${probe.height} ${probe.fps}fps`);
    }
    return { output_key: plan.output_key, probe };
  },
};
