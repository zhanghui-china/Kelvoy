import type { Shot, ShotStatus } from "@kelvoy/engine";
import { SHOT_STATUS_LABELS } from "../labels";

// 当前审核点下"还没决策"的镜（FR-05 待审队列视图）。审核 2 的决策是"选了
// 一张关键帧"，审核 3 的决策是"这镜通过了"，所以两处的未决状态集合不同。
const PENDING_BY_GATE: Record<"kf" | "clip", ShotStatus[]> = {
  kf: ["generating_kf", "kf_ready", "rejected", "failed", "draft"],
  clip: ["generating_clip", "clip_ready", "rejected", "failed", "kf_selected"],
};

export default function ReviewQueue({
  gate,
  shots,
  currentNo,
  onPick,
}: {
  gate: "kf" | "clip";
  shots: Shot[];
  currentNo: number | null;
  onPick: (no: number) => void;
}) {
  const pendingStatuses = new Set(PENDING_BY_GATE[gate]);
  const pending = shots.filter((s) => pendingStatuses.has(s.status));
  const decided = shots.length - pending.length;

  return (
    <aside className="k-desk-queue" aria-label="待审队列">
      <div className="k-card-title">待审队列</div>
      <div className="k-card-meta">
        已决策 {decided} / {shots.length} 镜
      </div>
      {pending.length === 0 ? (
        <p className="k-empty">全部镜都已决策。</p>
      ) : (
        <ul className="k-desk-queue-list">
          {pending.map((shot) => (
            <li key={shot.no}>
              <button
                type="button"
                className={`k-desk-queue-item ${currentNo === shot.no ? "is-current" : ""}`}
                onClick={() => onPick(shot.no)}
              >
                <span>第 {shot.no} 镜</span>
                <span className="k-card-meta">{SHOT_STATUS_LABELS[shot.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="k-card-meta">J / K 或 ← / → 切换当前镜。</p>
    </aside>
  );
}
