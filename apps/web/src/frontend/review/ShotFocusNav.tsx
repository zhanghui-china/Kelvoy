import { neighboringShot } from "./shot-focus";

export function ShotFocusNav({
  shotNos, currentNo, showAll, onPick, onToggle,
}: {
  shotNos: number[];
  currentNo: number | null;
  showAll: boolean;
  onPick: (no: number) => void;
  onToggle: () => void;
}) {
  const previous = neighboringShot(shotNos, currentNo, -1);
  const next = neighboringShot(shotNos, currentNo, 1);
  return (
    <nav className="k-desk-focus-nav" aria-label="镜头导航">
      <span className="k-card-meta" aria-live="polite">
        {currentNo === null ? "暂无镜头" : `第 ${currentNo} 镜 · ${shotNos.length} 镜共计`}
      </span>
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny"
        disabled={previous === null} onClick={() => previous !== null && onPick(previous)}>上一镜</button>
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny"
        disabled={next === null} onClick={() => next !== null && onPick(next)}>下一镜</button>
      <button type="button" className="k-btn k-btn-secondary k-btn-tiny"
        aria-pressed={showAll} onClick={onToggle}>{showAll ? "只看当前镜" : "查看全部镜头"}</button>
    </nav>
  );
}
