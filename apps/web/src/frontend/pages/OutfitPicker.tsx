import type { Persona } from "@kelvoy/engine";
import { Link } from "react-router-dom";
import { assetUrl } from "../api/client";
import { outfitFitsSeason, outfitPickState, outfitThumbKey, sortOutfitsForSeason } from "./outfit-helpers";

/**
 * 新建作品时选穿搭（ADR-0015）：第一项永远是"默认穿搭"（即角色参考图），
 * 其后适合本季的排前并带"适合本季"。只有自己的角色有可能没有穿搭，所以没有穿搭时
 * 给一个去添加的入口；官方角色目前没有穿搭，什么都不显示。
 */
export default function OutfitPicker({ persona, season, value, onChange }: {
  persona: Persona; season: string; value: string; onChange: (outfitId: string) => void;
}) {
  const outfits = sortOutfitsForSeason(persona.outfits ?? [], season);
  if (outfits.length === 0) {
    if (persona.owner_id === null) return null;
    return (
      <p className="k-card-meta">
        想让「{persona.name}」在不同场景换衣服？<Link to={`/personas/${persona.persona_id}/edit`}>去添加穿搭 →</Link>
      </p>
    );
  }
  // 默认穿搭永远可选：三视图没就绪时生成回落到 refs[0]。其余穿搭只有 ready（或无全身照的老穿搭）才可选。
  const defaultNote = persona.views_status === "ready" ? null : persona.views_status === "pending" ? "三视图生成中，暂用原图" : "未生成三视图";
  const options = [
    { id: "", name: "默认穿搭", note: persona.default_outfit, image: persona.views?.front ?? persona.refs[0],
      fits: false, selectable: true, warn: defaultNote },
    ...outfits.map((o) => {
      const pick = outfitPickState(o);
      return { id: o.outfit_id, name: o.name, note: o.desc || o.seasons.join("、"), image: outfitThumbKey(o),
        fits: outfitFitsSeason(o, season), selectable: pick.selectable, warn: pick.note };
    }),
  ];
  return (
    <div className="k-outfit-picker" role="group" aria-label="选择穿搭">
      <div className="k-card-meta">本期穿搭{season ? `（季节：${season}）` : ""}。选中穿搭的三视图设定图会作为人物参考；三视图未就绪的穿搭暂不能选。</div>
      {options.map((option) => (
        <button type="button" key={option.id || "default"} aria-pressed={value === option.id}
          disabled={!option.selectable}
          className={`k-create-persona-card${value === option.id ? " active" : ""}`} onClick={() => onChange(option.id)}>
          <span className="k-create-persona-avatar">
            {option.image ? <img src={assetUrl(option.image)} alt="" /> : option.name.slice(0, 1)}
          </span>
          <span><strong>{option.name}{option.fits ? " · 适合本季" : ""}</strong><small>{option.note || "—"}{option.warn ? ` · ${option.warn}` : ""}</small></span>
          <span className="k-create-persona-check" aria-hidden="true">✓</span>
        </button>
      ))}
    </div>
  );
}
