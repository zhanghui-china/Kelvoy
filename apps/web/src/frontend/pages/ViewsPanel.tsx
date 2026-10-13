import { useCallback, useState } from "react";
import type { Persona, PersonaOutfit } from "@kelvoy/engine";
import { PERSONA_VIEW_CREDITS_ESTIMATE } from "../../shared/usage";
import { AssetImage } from "../AssetImage";
import { assetUrl, listPersonas } from "../api/client";
import { useViewsJob } from "../hooks/useViewsJob";
import "./ViewsPanel.css";
import { viewsFailureReason, viewsProgressText, viewsTargetState } from "./views-view";

const VIEW_LABELS = [["front", "正面"], ["side", "侧面"], ["back", "背面"]] as const;
const COST = `预估 ${PERSONA_VIEW_CREDITS_ESTIMATE} 积分`;

/**
 * 一个穿搭（outfit 为 null = 默认穿搭）的三视图区块（ADR-0017）：none / pending / ready / failed 四态。
 * 状态以角色文档为准；生成中靠 useViewsJob 轮询 job，终态后重新读取角色文档并通过 onChange 交回页面。
 */
export default function ViewsPanel({ persona, outfit, onChange }: {
  persona: Persona; outfit: PersonaOutfit | null; onChange: (persona: Persona) => void;
}) {
  const { source, status, views } = viewsTargetState(persona, outfit);
  const [confirming, setConfirming] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const label = outfit ? `「${outfit.name}」` : "默认穿搭";

  const refresh = useCallback(async () => {
    const result = await listPersonas();
    if (!result.ok) { setRefreshError("三视图状态刷新失败，请刷新页面"); return; }
    setRefreshError(null);
    const latest = result.personas.find((p) => p.persona_id === persona.persona_id);
    if (latest) onChange(latest);
  }, [persona.persona_id, onChange]);

  const { job, busy, error, start, cancel } = useViewsJob({
    personaId: persona.persona_id, outfitId: outfit?.outfit_id ?? null, status, onSettled: () => void refresh(),
  });

  const heading = <h4 className="k-views-title">三视图 · {label}</h4>;
  let body;
  if (!source) {
    body = <p className="k-card-meta">这是旧式穿搭，没有全身照，不支持三视图；新建穿搭时上传一张全身照即可生成。</p>;
  } else if (status === "pending") {
    body = (
      <div className="k-views-progress" role="status" aria-live="polite">
        <progress aria-label={`${label}三视图生成进度`} />
        <span>{viewsProgressText(job)}</span>
        <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy || !job}
          onClick={() => void cancel()}>{busy ? "取消中…" : "取消生成"}</button>
      </div>
    );
  } else if (status === "ready" && views) {
    body = (
      <>
        <div className="k-views-grid">
          {VIEW_LABELS.map(([key, text]) => (
            <AssetImage key={key} src={assetUrl(views[key])} alt={`${label}${text}`} caption={text} />
          ))}
        </div>
        {confirming ? (
          <div className="k-views-confirm" role="group" aria-label="确认重新生成">
            <p className="k-card-meta">重新生成会产生新的版本并消耗积分（{COST}）；旧版本文件保留，已建作品不受影响。失败或取消会还原当前版本。</p>
            <button type="button" className="k-btn k-btn-primary k-btn-tiny" disabled={busy}
              onClick={() => void start(true).then(() => setConfirming(false))}>{busy ? "提交中…" : `确认重新生成（${COST}）`}</button>
            <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy}
              onClick={() => setConfirming(false)}>取消</button>
          </div>
        ) : (
          <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy}
            onClick={() => setConfirming(true)}>重新生成</button>
        )}
      </>
    );
  } else {
    body = (
      <>
        {status === "failed" && <p className="k-error" role="alert">三视图生成失败：{viewsFailureReason(job)}</p>}
        {status === "none" && <p className="k-card-meta">还没有三视图。生成后，作品会用正 / 侧 / 背设定图作人物参考，全身镜头更稳定。</p>}
        <button type="button" className="k-btn k-btn-primary k-btn-tiny" disabled={busy}
          onClick={() => void start(false)}>{busy ? "提交中…" : status === "failed" ? `重试（${COST}）` : `生成三视图（${COST}）`}</button>
      </>
    );
  }

  return (
    <section className="k-views" aria-label={`${label}三视图`}>
      {heading}
      {body}
      {(error ?? refreshError) && <p className="k-error" role="alert">{error ?? refreshError}</p>}
    </section>
  );
}
