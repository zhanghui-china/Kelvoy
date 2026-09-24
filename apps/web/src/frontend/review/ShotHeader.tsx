import type { Shot } from "@kelvoy/engine";
import { SHOT_STATUS_LABELS } from "../labels";

export { AssetImage } from "../AssetImage";

// 审片台三个审核视图共用的小件：镜头抬头、状态 pill、会缺文件的图/视频、
// 错误条。单独一个文件，免得三个视图各写一遍。

export function ShotStatusPill({ shot }: { shot: Shot }) {
  const accent = shot.status === "approved" || shot.status === "kf_selected";
  return (
    <span className={`k-pill ${accent ? "k-pill-accent" : ""}`}>{SHOT_STATUS_LABELS[shot.status]}</span>
  );
}

export function ShotHeader({ shot, children }: { shot: Shot; children?: React.ReactNode }) {
  return (
    <div className="k-desk-shot-head">
      <span className="k-desk-shot-no">第 {shot.no} 镜</span>
      <ShotStatusPill shot={shot} />
      {shot.bad_shot_reported && <span className="k-pill">已报告坏镜</span>}
      <span className="k-desk-shot-beat">{shot.beat}</span>
      <span className="k-nav-spacer" />
      {children}
    </div>
  );
}

export function MutationError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="k-error" role="alert">
      {error}
    </p>
  );
}
