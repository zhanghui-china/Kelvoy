import { DESTINATION_TYPE_LABELS } from "../labels";
import type { LibraryType } from "./resource-library";
import "./ResourceLibrary.css";
export function LibraryFilters({ label, query, type, onQuery, onType, count }: {
  label: string; query: string; type: LibraryType; onQuery: (value: string) => void;
  onType: (value: LibraryType) => void; count: number;
}) {
  return <div className="k-library-toolbar">
    <label className="k-field">搜索{label}<input type="search" value={query}
      placeholder={`搜索${label}…`} onChange={e => onQuery(e.target.value)} /></label>
    <label className="k-field">{label}类型<select value={type} onChange={e => onType(e.target.value as LibraryType)}>
      <option value="all">全部类型</option>
      {Object.entries(DESTINATION_TYPE_LABELS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select></label>
    <p role="status" className="k-card-meta">找到 {count} 个{label}</p>
    {(query || type !== "all") && <button type="button" className="k-btn k-btn-secondary"
      onClick={() => { onQuery(""); onType("all"); }}>清除筛选</button>}
  </div>;
}
