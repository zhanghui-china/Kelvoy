import { useState } from "react";
import type { Destination, Episode, Persona, Shot } from "@kelvoy/engine";
import { assetUrl, continueEpisode, episodeFileUrl, patchShot, regenShot } from "../api/client";
import { GuideTip } from "../GuideTip";
import { describeWriteError } from "./errors";
import ReviewQueue from "./ReviewQueue";
import { AssetImage, MutationError, ShotHeader } from "./ShotHeader";
import { canRegen, regenHint } from "./shot-rules";
import type { EpisodeMutation } from "./useEpisodeMutation";
import { useShotNavigation } from "./useShotNavigation";

/**
 * 审核 2（PRD §4/FR-05）：每镜从 N 候选中点选一张，或标记重生成并改
 * prompt。候选按 candidates 数组的原始顺序并排铺开——**不排序、不打分、
 * 不标"不可选"**：自动检测器（裁判模型）不在 MVP 范围（§8），质量红线只
 * 靠人工执行。
 */
function KeyframeShot({
  episode,
  shot,
  destination,
  persona,
  mutation,
  isCurrent,
  registerShot,
}: {
  episode: Episode;
  shot: Shot;
  destination: Destination | null;
  persona: Persona | null;
  mutation: EpisodeMutation;
  isCurrent: boolean;
  registerShot: (no: number, el: HTMLElement | null) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState(shot.kf_prompt);
  const [error, setError] = useState<string | null>(null);

  const landmark = destination?.landmarks.find((l) => l.id === shot.landmark) ?? null;

  async function select(candidate: string) {
    setError(null);
    const result = await mutation.run((rowVersion) =>
      patchShot(episode.episode_id, shot.no, rowVersion, {
        kf_selected: candidate,
        // kf_ready -> kf_selected 是"选定"这一步的状态机事件。已经选过的镜
        // 再换一张只改 kf_selected：kf_selected -> kf_selected 不是合法转移
        // （state/shot.ts），带上 status 反而会被 400 挡掉。
        ...(shot.status === "kf_ready" ? { status: "kf_selected" as const } : {}),
      }),
    );
    if (result && !result.ok) setError(describeWriteError(result));
  }

  async function regenerate(withPrompt: boolean) {
    setError(null);
    if (withPrompt) {
      const patched = await mutation.run((rowVersion) =>
        patchShot(episode.episode_id, shot.no, rowVersion, { kf_prompt: prompt }),
      );
      if (!patched) return;
      if (!patched.ok) {
        setError(describeWriteError(patched));
        return; // prompt 没写进去就不该重生成，否则用的还是旧 prompt
      }
    }
    const result = await mutation.run((rowVersion) =>
      regenShot(episode.episode_id, shot.no, rowVersion, "keyframe"),
    );
    if (result && !result.ok) setError(describeWriteError(result));
    else setPromptOpen(false);
  }

  return (
    <article
      className={`k-card k-desk-shot ${isCurrent ? "is-current" : ""}`}
      ref={(el) => registerShot(shot.no, el)}
    >
      <ShotHeader shot={shot} />
      <div className="k-desk-shot-body">
        <div>
          <div className="k-card-meta">候选（点一张选定，顺序即生成顺序，不做打分排序）</div>
          {shot.candidates.length === 0 ? (
            <p className="k-empty">还没有候选图。</p>
          ) : (
            <div className="k-desk-candidates">
              {shot.candidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate}
                  className={`k-desk-candidate ${shot.kf_selected === candidate ? "is-selected" : ""}`}
                  aria-pressed={shot.kf_selected === candidate}
                  disabled={mutation.pending || shot.status === "approved"}
                  onClick={() => select(candidate)}
                >
                  <AssetImage
                    src={episodeFileUrl(episode.episode_id, candidate)}
                    alt={`第 ${shot.no} 镜候选 ${candidate}`}
                  />
                  <span className="k-card-meta">{candidate.split("/").pop()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="k-desk-refs">
          {landmark && (
            <div>
              <div className="k-card-meta">地标实景参考 · {landmark.name}</div>
              {landmark.refs.map((ref) => (
                <AssetImage key={ref} src={assetUrl(ref)} alt={`${landmark.name} 实景参考`} />
              ))}
            </div>
          )}
          {persona && persona.refs.length > 0 && (
            <div>
              <div className="k-card-meta">角色参考 · {persona.name}</div>
              <AssetImage src={assetUrl(persona.refs[0])} alt={`${persona.name} 参考图`} />
            </div>
          )}
        </div>
      </div>

      <MutationError error={error} />
      <div className="k-desk-actions">
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          onClick={() => setPromptOpen(!promptOpen)}
        >
          {promptOpen ? "收起 prompt" : "改 prompt 并重生成"}
        </button>
        <button
          type="button"
          className="k-btn k-btn-secondary k-btn-tiny"
          disabled={mutation.pending || !canRegen(shot)}
          onClick={() => regenerate(false)}
        >
          直接重生成
        </button>
        {regenHint(shot) && <span className="k-card-meta">{regenHint(shot)}</span>}
      </div>
      {promptOpen && (
        <div className="k-desk-editor">
          <label className="k-field">
            关键帧 prompt
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="k-desk-actions">
            <button
              type="button"
              className="k-btn k-btn-primary k-btn-tiny"
              disabled={mutation.pending || !canRegen(shot)}
              onClick={() => regenerate(true)}
            >
              保存 prompt 并重生成
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function KeyframeReview({
  episode,
  destination,
  persona,
  mutation,
}: {
  episode: Episode;
  destination: Destination | null;
  persona: Persona | null;
  mutation: EpisodeMutation;
}) {
  const [gridOpen, setGridOpen] = useState(false);
  const { currentNo, focusShot, registerShot } = useShotNavigation(episode.shots.map((s) => s.no));

  const unselected = episode.shots.filter((s) =>
    s.status !== "approved" && (s.status !== "kf_selected" || !s.kf_selected)).length;

  return (
    <div className="k-desk-layout">
      <section className="k-desk-main">
        <div className="k-desk-toolbar">
          <div className="k-card-title">审核 2 · 关键帧</div>
          <span className="k-nav-spacer" />
          {episode.grid_refs.length > 0 && (
            <button
              type="button"
              className="k-btn k-btn-secondary k-btn-tiny"
              aria-expanded={gridOpen}
              onClick={() => setGridOpen(!gridOpen)}
            >
              {gridOpen ? "收起策划稿" : "查看策划稿"}
            </button>
          )}
        </div>

        <GuideTip section="keyframes">对照角色和地标参考图，逐镜选一张候选；不合适时可改 prompt 后重生成。</GuideTip>

        {gridOpen && (
          <div className="k-card">
            <div className="k-card-meta">网格策划稿（只看不审，不是审核点）</div>
            <div className="k-desk-candidates">
              {episode.grid_refs.map((ref) => (
                <AssetImage
                  key={ref}
                  src={episodeFileUrl(episode.episode_id, ref)}
                  alt="网格策划稿"
                  caption={ref}
                />
              ))}
            </div>
          </div>
        )}

        <MutationError error={mutation.error} />

        {episode.shots.map((shot) => (
          <KeyframeShot
            key={shot.no}
            episode={episode}
            shot={shot}
            destination={destination}
            persona={persona}
            mutation={mutation}
            isCurrent={currentNo === shot.no}
            registerShot={registerShot}
          />
        ))}

        <div className="k-desk-actions">
          <button
            type="button"
            className="k-btn k-btn-primary"
            disabled={mutation.pending || unselected > 0 || episode.status !== "kf_review"}
            onClick={() => mutation.run((rowVersion) => continueEpisode(episode.episode_id, rowVersion))}
          >
            继续 → 生成视频
          </button>
          {unselected > 0 && <span className="k-card-meta">还有 {unselected} 镜没选关键帧。</span>}
        </div>
      </section>

      <ReviewQueue gate="kf" shots={episode.shots} currentNo={currentNo} onPick={focusShot} />
    </div>
  );
}
