import { ShotFailureNotice } from "./ShotFailure";
import type { ShotFailureSummary } from "../api/client";
import { useEffect, useRef, useState } from "react";
import type { Episode, Shot } from "@kelvoy/engine";
import type { WriteResult } from "../api/client";
import {
  continueEpisode,
  convertLegacyCuts,
  episodeFileUrl,
  patchShot,
  regenShot,
  reportBadShot,
} from "../api/client";
import { describeWriteError } from "./errors";
import { GuideTip } from "../GuideTip";
import ReviewQueue from "./ReviewQueue";
import { ShotFocusNav } from "./ShotFocusNav";
import { MutationError, ShotHeader } from "./ShotHeader";
import { focusedShot } from "./shot-focus";
import { canRegen, regenHint } from "./shot-rules";
import type { EpisodeMutation } from "./useEpisodeMutation";
import { useShotNavigation } from "./useShotNavigation";

/**
 * §8 质量红线五项。勾选状态只是本地 UI 状态，**故意不持久化**：Shot schema
 * 里没有这五个字段，为了一个"逐条确认"的交互去改数据模型不值得。将来真要
 * 留痕（谁在什么时候确认了哪一条），再同一个 commit 改 schema + PRD §6。
 */
const REDLINES = [
  { key: "identity", label: "人物一致" },
  { key: "hands", label: "手部正常" },
  { key: "landmark", label: "地标形态正确" },
  { key: "physics", label: "物理合理" },
  { key: "text", label: "无可读文字" },
] as const;

// 片段长度未知（video 元数据还没加载/文件不存在）时滑块的上限，比目标时长
// 宽一点就够用了——真实长度一到就换成真实值。
const FALLBACK_CLIP_SECONDS = 5;
const PREVIEW_SECONDS = 1;

function ClipShot({
  episode,
  shot,
  mutation,
  isCurrent,
  hidden,
  registerShot,
}: {
  episode: Episode;
  shot: Shot;
  mutation: EpisodeMutation;
  isCurrent: boolean;
  hidden: boolean;
  registerShot: (no: number, el: HTMLElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState(shot.trim_start_s ?? 0);
  const savedTrimRef = useRef(shot.trim_start_s ?? 0);
  const serverTrimRef = useRef(shot.trim_start_s ?? 0);
  const trimSaveRef = useRef<Promise<boolean> | null>(null);
  const approvalRef = useRef(false);
  const [approving, setApproving] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const serverTrim = shot.trim_start_s ?? 0;
  if (serverTrim !== serverTrimRef.current) {
    serverTrimRef.current = serverTrim;
    savedTrimRef.current = serverTrim;
  }

  const total = clipSeconds ?? FALLBACK_CLIP_SECONDS;
  const fixedCut = episode.cut_policy === "fixed_1s";
  const longCut = episode.cut_policy === "long_3_6";
  const cutSeconds = fixedCut ? 1 : longCut ? Math.min(shot.duration_s, Math.max(0, total - trimStart)) : shot.duration_s;
  const maxStart = Math.max(0, fixedCut
    ? Math.floor((total - cutSeconds) * 30) / 30
    : longCut ? Math.floor((total - 3) * episode.render.fps) / episode.render.fps
      : Number((total - cutSeconds).toFixed(2)));
  const allChecked = REDLINES.every((r) => checked[r.key]);

  // 预览选段：一秒作品保持一秒；长镜按建议时长与剩余素材预览。
  function preview(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    void video.play().then(() => {
      window.setTimeout(() => video.pause(), (longCut ? Math.min(shot.duration_s, Math.max(0, total - value)) : PREVIEW_SECONDS) * 1000);
    }).catch(() => {
      /* 文件还没生成，或浏览器拒绝自动播放——静默即可，不影响改起点 */
    });
  }

  function saveTrim(): Promise<boolean> {
    if (trimSaveRef.current) return trimSaveRef.current;
    if (trimStart === savedTrimRef.current) return Promise.resolve(true);
    const value = trimStart;
    setError(null);
    const saving = mutation.run((rowVersion) =>
      patchShot(episode.episode_id, shot.no, rowVersion, { trim_start_s: value }),
    ).then((result) => {
      if (!result || !result.ok) {
        if (result) setError(describeWriteError(result));
        return false;
      }
      savedTrimRef.current = value;
      return true;
    }).finally(() => {
      if (trimSaveRef.current === saving) trimSaveRef.current = null;
    });
    trimSaveRef.current = saving;
    return saving;
  }

  async function approve() {
    if (approvalRef.current) return;
    approvalRef.current = true;
    setApproving(true);
    try {
      if (!(await saveTrim())) return;
      setError(null);
      const result = await mutation.run((rowVersion) =>
        patchShot(episode.episode_id, shot.no, rowVersion, { status: "approved" }),
      );
      if (result && !result.ok) setError(describeWriteError(result));
    } finally {
      approvalRef.current = false;
      setApproving(false);
    }
  }

  async function runWrite(call: (rowVersion: number) => Promise<WriteResult>) {
    setError(null);
    const result = await mutation.run(call);
    if (result && !result.ok) setError(describeWriteError(result));
  }

  return (
    <article
      className={`k-card k-desk-shot ${isCurrent ? "is-current" : ""}`}
      data-shot-no={shot.no}
      hidden={hidden}
      ref={(el) => registerShot(shot.no, el)}
    >
      <ShotHeader shot={shot} />
      <div className="k-desk-shot-body">
        <div>
          {shot.clip === null ? (
            <div className="k-media-missing">
              <div>第 {shot.no} 镜片段</div>
              <div className="k-card-meta">文件未生成</div>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="k-media"
              src={episodeFileUrl(episode.episode_id, shot.clip)}
              controls
              muted
              preload="metadata"
              onLoadedMetadata={(e) => {
                const duration = e.currentTarget.duration;
                if (Number.isFinite(duration) && duration > 0) setClipSeconds(duration);
              }}
              aria-label={`第 ${shot.no} 镜片段`}
            />
          )}
          <label className="k-field k-desk-slider">
            起点（{longCut ? `建议 ${shot.duration_s} 秒，最终分配 3–6 秒` : `截取 ${cutSeconds} 秒`}，片段长 {total.toFixed(1)} 秒）
            <input
              type="range"
              min={0}
              max={maxStart}
              step={fixedCut ? 1 / 30 : longCut ? 1 / episode.render.fps : 0.1}
              value={Math.min(trimStart, maxStart)}
              aria-valuetext={`起点 ${trimStart.toFixed(2)} 秒`}
              disabled={mutation.pending}
              onChange={(e) => {
                const value = Number(e.target.value);
                const snapped = fixedCut ? Math.round(value * 30) / 30 : longCut
                  ? Math.min(maxStart, Math.round(value * episode.render.fps) / episode.render.fps) : value;
                setTrimStart(snapped);
                preview(snapped);
              }}
              onPointerUp={saveTrim}
              onBlur={saveTrim}
            />
            <span className="k-card-meta">
              起点 {trimStart.toFixed(2)} 秒（已保存 {(shot.trim_start_s ?? 0).toFixed(2)} 秒）
            </span>
          </label>
        </div>

        <fieldset className="k-desk-checklist">
          <legend className="k-card-meta">质量红线逐条确认（命中任一条就不能进成片）</legend>
          {REDLINES.map((redline) => (
            <label key={redline.key}>
              <input
                type="checkbox"
                checked={Boolean(checked[redline.key])}
                onChange={(e) => setChecked({ ...checked, [redline.key]: e.target.checked })}
              />
              {redline.label}
            </label>
          ))}
        </fieldset>
      </div>

      <MutationError error={error} />
      <div className="k-desk-actions">
        <button
          type="button"
          className="k-btn k-btn-primary k-btn-tiny"
          disabled={approving || (mutation.pending && !trimSaveRef.current) || !allChecked || shot.status !== "clip_ready"}
          onClick={approve}
        >
          通过这一镜
        </button>
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          disabled={mutation.pending || !canRegen(shot)}
          onClick={() =>
            runWrite((rowVersion) => regenShot(episode.episode_id, shot.no, rowVersion, "video"))
          }
        >
          标记重生成
        </button>
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          disabled={mutation.pending || shot.bad_shot_reported || !canRegen(shot)}
          onClick={() =>
            runWrite((rowVersion) => reportBadShot(episode.episode_id, shot.no, rowVersion, "video"))
          }
        >
          {shot.bad_shot_reported ? "已报告" : "报告坏镜（免费重生成一次）"}
        </button>
        {!allChecked && shot.status === "clip_ready" && (
          <span className="k-card-meta">五项确认齐了才能通过。</span>
        )}
        {regenHint(shot) && <span className="k-card-meta">{regenHint(shot)}</span>}
      </div>
    </article>
  );
}

/** 审核 3（PRD §4/FR-05）：播放器 + 可拖拽起点滑块 + 质量红线逐条确认。 */
export default function ClipReview({
  episode,
  shotFailures,
  mutation,
}: {
  episode: Episode;
  shotFailures?: ShotFailureSummary[];
  mutation: EpisodeMutation;
}) {
  const [showAll, setShowAll] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const { currentNo, focusShot, registerShot } = useShotNavigation(episode.shots.map((s) => s.no));
  const shotNos = episode.shots.map((shot) => shot.no);
  const activeNo = focusedShot(shotNos, currentNo);
  useEffect(() => {
    if (currentNo === null && activeNo !== null) focusShot(activeNo);
  }, [activeNo, currentNo, focusShot]);
  useEffect(() => {
    if (activeNo !== null) {
      mainRef.current?.querySelector<HTMLElement>(`[data-shot-no="${activeNo}"]`)?.scrollIntoView({ block: "center" });
    }
  }, [activeNo]);
  const unapproved = episode.shots.filter((s) => s.status !== "approved").length;

  return (
    <div className="k-desk-layout">
      <section className="k-desk-main" ref={mainRef}>
        <div className="k-desk-toolbar">
          <div className="k-card-title">审核 3 · 片段</div>
        </div>
        <GuideTip section="clips">{episode.cut_policy === "fixed_1s"
          ? "每镜严格截取 1 秒，起点按 30 fps 帧格调整；看完动作并确认五项质量红线后再通过。坏镜可报告并免费重生成一次。"
          : episode.cut_policy === "long_3_6"
            ? "每镜成片 3–6 秒，最终时长由素材与目标预算分配；起点后至少保留 3 秒素材。逐镜检查动作与五项质量红线，通过后进入合成设置。"
          : "旧版剪辑沿用原有选段长度；逐镜检查动作与五项质量红线。想改用每镜 1 秒剪辑时，先转换并重新确认。"}</GuideTip>
        <ShotFocusNav shotNos={shotNos} currentNo={activeNo} showAll={showAll}
          onPick={focusShot} onToggle={() => setShowAll(!showAll)} />
        <MutationError error={mutation.error} />
        <ShotFailureNotice shot={episode.shots.find(shot => shot.no === activeNo)} failures={shotFailures} />
        {episode.cut_policy !== "fixed_1s" && episode.cut_policy !== "long_3_6" && episode.shots.every((shot) => !!shot.clip) &&
          <div className="k-card">
            <div className="k-card-title">旧版剪辑</div>
            <p className="k-card-meta">可保留现有片段，改为每镜严格 1 秒。转换后需要重新确认每镜起点和质量。</p>
            <button type="button" className="k-btn k-btn-secondary" disabled={mutation.pending}
              onClick={() => mutation.run((rowVersion) => convertLegacyCuts(episode.episode_id, rowVersion))}>
              使用新版 1 秒剪辑
            </button>
          </div>}

        {episode.shots.map((shot) => (
          <ClipShot
            key={shot.no}
            episode={episode}
            shot={shot}
            mutation={mutation}
            isCurrent={activeNo === shot.no}
            hidden={!showAll && activeNo !== shot.no}
            registerShot={registerShot}
          />
        ))}

        <div className="k-desk-actions">
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending || unapproved > 0 || episode.status !== "clip_review"}
            onClick={() => mutation.run((rowVersion) => continueEpisode(episode.episode_id, rowVersion))}
          >
            {["fixed_1s", "long_3_6"].includes(episode.cut_policy ?? "") ? "下一步：合成设置" : "继续 → 合成"}
          </button>
          {unapproved > 0 && <span className="k-card-meta">还有 {unapproved} 镜没通过。</span>}
        </div>
      </section>

      <ReviewQueue gate="clip" shots={episode.shots} currentNo={activeNo} onPick={focusShot} />
    </div>
  );
}
