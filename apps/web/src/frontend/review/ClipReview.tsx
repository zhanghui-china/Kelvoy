import { useRef, useState } from "react";
import type { Episode, Shot } from "@kelvoy/engine";
import type { WriteResult } from "../api/client";
import {
  continueEpisode,
  episodeFileUrl,
  patchShot,
  regenShot,
  reportBadShot,
} from "../api/client";
import { describeWriteError } from "./errors";
import ReviewQueue from "./ReviewQueue";
import { MutationError, ShotHeader } from "./ShotHeader";
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
  registerShot,
}: {
  episode: Episode;
  shot: Shot;
  mutation: EpisodeMutation;
  isCurrent: boolean;
  registerShot: (no: number, el: HTMLElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState(shot.trim_start_s ?? 0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const total = clipSeconds ?? FALLBACK_CLIP_SECONDS;
  const fixedCut = episode.cut_policy === "fixed_1s";
  const cutSeconds = fixedCut ? 1 : shot.duration_s;
  const maxStart = Math.max(0, fixedCut
    ? Math.floor((total - cutSeconds) * 30) / 30
    : Number((total - cutSeconds).toFixed(2)));
  const allChecked = REDLINES.every((r) => checked[r.key]);

  // 拖动时实时预览那 1 秒（FR-05）：把播放头挪到起点，放 1 秒就停。
  function preview(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    void video.play().then(() => {
      window.setTimeout(() => video.pause(), PREVIEW_SECONDS * 1000);
    }).catch(() => {
      /* 文件还没生成，或浏览器拒绝自动播放——静默即可，不影响改起点 */
    });
  }

  async function saveTrim() {
    if (trimStart === (shot.trim_start_s ?? 0)) return;
    setError(null);
    const result = await mutation.run((rowVersion) =>
      patchShot(episode.episode_id, shot.no, rowVersion, { trim_start_s: trimStart }),
    );
    if (result && !result.ok) setError(describeWriteError(result));
  }

  async function approve() {
    setError(null);
    const result = await mutation.run((rowVersion) =>
      patchShot(episode.episode_id, shot.no, rowVersion, { status: "approved" }),
    );
    if (result && !result.ok) setError(describeWriteError(result));
  }

  async function runWrite(call: (rowVersion: number) => Promise<WriteResult>) {
    setError(null);
    const result = await mutation.run(call);
    if (result && !result.ok) setError(describeWriteError(result));
  }

  return (
    <article
      className={`k-card k-desk-shot ${isCurrent ? "is-current" : ""}`}
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
            起点（截取 {cutSeconds} 秒，片段长 {total.toFixed(1)} 秒）
            <input
              type="range"
              min={0}
              max={maxStart}
              step={fixedCut ? 1 / 30 : 0.1}
              value={Math.min(trimStart, maxStart)}
              aria-valuetext={`起点 ${trimStart.toFixed(2)} 秒`}
              disabled={mutation.pending}
              onChange={(e) => {
                const value = Number(e.target.value);
                const snapped = fixedCut ? Math.round(value * 30) / 30 : value;
                setTrimStart(snapped);
                preview(snapped);
              }}
              onPointerUp={saveTrim}
              onKeyUp={saveTrim}
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
          disabled={mutation.pending || !allChecked || shot.status !== "clip_ready"}
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
  mutation,
}: {
  episode: Episode;
  mutation: EpisodeMutation;
}) {
  const { currentNo, focusShot, registerShot } = useShotNavigation(episode.shots.map((s) => s.no));
  const unapproved = episode.shots.filter((s) => s.status !== "approved").length;

  return (
    <div className="k-desk-layout">
      <section className="k-desk-main">
        <div className="k-desk-toolbar">
          <div className="k-card-title">审核 3 · 片段</div>
        </div>
        <MutationError error={mutation.error} />

        {episode.shots.map((shot) => (
          <ClipShot
            key={shot.no}
            episode={episode}
            shot={shot}
            mutation={mutation}
            isCurrent={currentNo === shot.no}
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
            {episode.cut_policy === "fixed_1s" ? "下一步：合成设置" : "继续 → 合成"}
          </button>
          {unapproved > 0 && <span className="k-card-meta">还有 {unapproved} 镜没通过。</span>}
        </div>
      </section>

      <ReviewQueue gate="clip" shots={episode.shots} currentNo={currentNo} onPick={focusShot} />
    </div>
  );
}
