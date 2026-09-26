import { Link } from "react-router-dom";
import { GUIDE_RESOURCES, GUIDE_SECTIONS, guideHref, type GuideId } from "./guide";
import "./GuideTip.css";

/** Short, contextual hint for any creation stage; the full explanation lives in /help. */
export function GuideTip({ section, children }: { section: GuideId; children: React.ReactNode }) {
  const guide = [...GUIDE_SECTIONS, ...GUIDE_RESOURCES].find((item) => item.id === section);
  return (
    <aside className="k-guide-tip">
      <span className="k-guide-tip-label">操作提示</span>
      <span>{children}</span>
      <Link to={guideHref(section)}>查看「{guide?.title}」指南 →</Link>
    </aside>
  );
}
