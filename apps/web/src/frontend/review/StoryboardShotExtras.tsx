import type { StoryboardDraft } from "../api/client";

/** Per-shot generation hints: whether a person is in frame, and (long_3_6 only) the suggested cut length. */
export default function StoryboardShotExtras({ draft, longCut, onChange }: {
  draft: StoryboardDraft; longCut: boolean;
  onChange: <K extends "duration_s" | "person_visible">(field: K, value: StoryboardDraft[K]) => void;
}) {
  return <div className="k-desk-editor-row">
    <label className="k-field"><span>
      <input type="checkbox" checked={draft.person_visible !== false}
        onChange={(e) => onChange("person_visible", e.target.checked)} /> 画面中有人物（含手、背影）
    </span></label>
    <p className="k-card-meta">取消勾选表示纯空镜（景物、环境）。修改后该镜已生成的关键帧与视频会作废，需要重新生成。</p>
    {longCut && <label className="k-field">建议时长（秒）
      <input type="number" min={3} max={6} step={0.5} required value={draft.duration_s ?? 4}
        onChange={(e) => onChange("duration_s", e.target.valueAsNumber)} />
      <span className="k-card-meta">实际时长由素材、选段与配乐共同决定。4 秒及以内生成 4 秒素材，超过 4 秒生成 5 秒素材（越过 4 秒会让该镜视频作废重生成）。</span>
    </label>}
  </div>;
}
