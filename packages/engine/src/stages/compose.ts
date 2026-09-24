import { musicLibraryProvider } from "../providers/music-library";
import type { ComposePlan, ComposePlanMusic } from "../providers/types";
import { planCuts } from "../rules/beat";
import type { Episode } from "../schema";
import { transitionEpisode } from "../state";
import type { StageContext } from "./types";

/**
 * Stage F — 合成 (PRD §4, FR-07, M1-13)。切片、卡拍对齐、账号级 LUT、
 * 片头片尾、标题、AI 标识（画面水印 + 元数据）、配乐、封装 1080×1920 30fps。
 *
 * 这个文件只做**纯计算**：把期 JSON 编译成一份后端无关的 ComposePlan，再交给
 * 调用方注入的 ComposeProvider 去执行。ffmpeg 在 apps/worker
 * （CLAUDE.md 不可越的边界："compose 是唯一碰 ffmpeg 的地方，只在 worker 上跑"）。
 *
 * 期级操作：不挑镜、不跳镜，重新合成也不动任何镜（PRD §4）。
 */

// PRD §8 合规：MVP 的显式 AI 标识文案，画面水印和元数据 comment 用同一句。
export const AI_LABEL_TEXT = "AI 生成 · 虚构角色 · 真实目的地";

/**
 * 成片路径是**约定**，不是 schema 字段——PRD §6 的 Episode 里没有"成片路径"，
 * 为了一个可推导的字符串去改数据模型不值得。前端/分享页按这个约定走既有的
 * `GET /api/episodes/:id/files/final/<episode_id>.mp4` 取成片。
 */
export function finalOutputKey(episodeId: string): string {
  return `final/${episodeId}.mp4`;
}

/** 解析 render.res（"1080x1920"）。宽高是渲染参数，坏值直接报错，不猜。 */
function parseRes(res: string): { w: number; h: number } {
  const match = /^(\d+)x(\d+)$/.exec(res.trim());
  const w = match ? Number(match[1]) : 0;
  const h = match ? Number(match[2]) : 0;
  if (w <= 0 || h <= 0) {
    throw new Error(`render.res 格式不对（应形如 "1080x1920"），实际 "${res}"`);
  }
  return { w, h };
}

async function resolveMusic(episode: Episode): Promise<ComposePlanMusic> {
  // 用户在交付页换过曲（episode.music.file 非空）就沿用，不重选——重新合成
  // 不应该把人挑好的配乐换掉。
  if (episode.music.file !== "") {
    return { file_key: episode.music.file, bpm: episode.music.bpm, license: episode.music.license };
  }
  const track = await musicLibraryProvider.selectTrack({ tone: episode.brief.tone });
  return { file_key: track.file, bpm: track.bpm, license: track.license };
}

/**
 * 把一期编译成合成计划。纯函数（async 只是因为选曲 provider 的接口是 async，
 * 曲库本身是代码常量，没有 IO）。
 */
export async function buildComposePlan(episode: Episode, context?: StageContext): Promise<ComposePlan> {
  const persona = context?.persona;
  if (!persona) {
    throw new Error("compose 阶段需要 persona（账号级 LUT / 标题样式，由调用方从 @kelvoy/store 读取，见 StageContext）");
  }

  const music = await resolveMusic(episode);
  const cuts = planCuts(episode.shots, music.bpm);

  return {
    episode_id: episode.episode_id,
    output_key: finalOutputKey(episode.episode_id),
    cuts,
    music,
    lut_key: persona.style.lut !== "" ? persona.style.lut : null,
    intro_key: episode.render.intro,
    outro_key: episode.render.outro,
    title: episode.render.title,
    title_style: persona.style.title_style,
    ai_label: episode.render.ai_label,
    ai_label_text: AI_LABEL_TEXT,
    // 隐式标识层（PRD §8）：写进封装容器，便于平台/审计在不看画面的情况下
    // 判定这是 AI 生成内容，并回溯到具体一期和当时的角色/目的地版本。
    metadata: {
      comment: AI_LABEL_TEXT,
      ai_generated: "true",
      kelvoy_episode_id: episode.episode_id,
      kelvoy_persona_version: String(episode.persona_version),
      kelvoy_destination_version: String(episode.destination_version),
    },
    res: parseRes(episode.render.res),
    fps: episode.render.fps,
  };
}

export async function runCompose(
  episode: Episode,
  _shotNo?: number,
  context?: StageContext,
): Promise<Episode> {
  if (!context?.compose) {
    throw new Error("compose 阶段需要 ComposeProvider（由 apps/worker 注入，engine 不碰 ffmpeg）");
  }

  const plan = await buildComposePlan(episode, context);
  await context.compose.compose({ plan });

  // 选中的曲子回写进期记录：license 是合规留痕，bpm 是下次重新合成时保持同一
  // 套切点的依据（PRD §8 / FR-07）。
  return {
    ...episode,
    status: transitionEpisode(episode.status, { type: "advance" }),
    music: plan.music
      ? { file: plan.music.file_key, bpm: plan.music.bpm, license: plan.music.license }
      : episode.music,
  };
}
