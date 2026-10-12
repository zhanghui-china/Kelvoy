import type { Persona } from "@kelvoy/engine";
import { Link } from "react-router-dom";
import { assetUrl } from "../api/client";
import { outfitFitsSeason, sortOutfitsForSeason } from "./outfit-helpers";

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
  const options = [
    { id: "", name: "默认穿搭", note: persona.default_outfit, image: persona.refs[0], fits: false },
    ...outfits.map((o) => ({ id: o.outfit_id, name: o.name, note: o.desc || o.seasons.join("、"),
      image: o.refs[0], fits: outfitFitsSeason(o, season) })),
  ];
  return (
    <div className="k-outfit-picker" role="group" aria-label="选择穿搭">
      <div className="k-card-meta">本期穿搭{season ? `（季节：${season}）` : ""}。选中的穿搭图会替代角色的第 1 张参考图。</div>
      {options.map((option) => (
        <button type="button" key={option.id || "default"} aria-pressed={value === option.id}
          className={`k-create-persona-card${value === option.id ? " active" : ""}`} onClick={() => onChange(option.id)}>
          <span className="k-create-persona-avatar">
            {option.image ? <img src={assetUrl(option.image)} alt="" /> : option.name.slice(0, 1)}
          </span>
          <span><strong>{option.name}{option.fits ? " · 适合本季" : ""}</strong><small>{option.note || "—"}</small></span>
          <span className="k-create-persona-check" aria-hidden="true">✓</span>
        </button>
      ))}
    </div>
  );
}
