import { type FormEvent, useRef, useState } from "react";
import { PERSONA_OUTFITS_MAX } from "@kelvoy/engine";
import type { Persona } from "@kelvoy/engine";
import { PERSONA_VIEW_CREDITS_ESTIMATE } from "../../shared/usage";
import { createSourceOutfit } from "../api/client";
import { describeWriteError } from "../review/errors";
import OutfitCard from "./OutfitCard";
import { parseSeasons } from "./outfit-helpers";

const ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * 角色编辑页的"穿搭"区块（ADR-0015 / ADR-0017）。独立于主表单：每次增删改都是一次即时保存，
 * 并让角色版本 +1，所以放在主 <form> 之外，不参与"保存修改"。
 * 新建穿搭只传 1 张全身照，三视图在各穿搭卡片里生成（OutfitCard → ViewsPanel）。
 */
export default function PersonaOutfits({ persona, onChange }: {
  persona: Persona; onChange: (persona: Persona) => void;
}) {
  const outfits = persona.outfits ?? [];
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [seasons, setSeasons] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = outfits.length >= PERSONA_OUTFITS_MAX;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("请选择 1 张这个角色穿这套衣服的全身照");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createSourceOutfit(persona.persona_id, { name: name.trim(), desc, seasons: parseSeasons(seasons), file });
    setBusy(false);
    if (!result.ok) {
      setError(describeWriteError(result));
      return;
    }
    setName(""); setDesc(""); setSeasons(""); setFile(null);
    onChange(result.persona);
  }

  return (
    <section className="k-card k-outfits" aria-labelledby="k-outfits-title">
      <h2 id="k-outfits-title">穿搭 <span className="k-pill">{outfits.length} / {PERSONA_OUTFITS_MAX}</span></h2>
      <p className="k-card-meta">
        给同一个角色准备不同的穿搭，新建作品时按场景或季节选一套。每套只需上传这个角色穿这套衣服的 1 张全身照
        （人像清晰、从头到脚完整），再生成正 / 侧 / 背三视图（{PERSONA_VIEW_CREDITS_ESTIMATE} 积分左右）；三视图就绪后才能在新建作品时选用。
      </p>
      {outfits.length === 0
        ? <p className="k-empty">还没有穿搭。</p>
        : <ul className="k-outfit-list">{outfits.map((o) => (
            <OutfitCard key={o.outfit_id} persona={persona} outfit={o} onSaved={onChange} />
          ))}</ul>}
      {full
        ? <p className="k-card-meta">已达 {PERSONA_OUTFITS_MAX} 套上限，删除一套后才能再添加。</p>
        : (
          <form className="k-outfit-add" onSubmit={add}>
            <h3>添加穿搭</h3>
            <label className="k-field">名称<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required placeholder="例如：秋日风衣" /></label>
            <label className="k-field">描述（可选）<input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} placeholder="例如：米色长风衣，白色高领毛衣" /></label>
            <label className="k-field">适合季节（可选，用顿号分隔）
              <input value={seasons} onChange={(e) => setSeasons(e.target.value)} placeholder="例如：秋、冬" /></label>
            {/* 按钮触发隐藏的 input：label+hidden 的写法进不了 Tab 顺序，键盘用户选不了文件。 */}
            <button type="button" className="k-btn k-btn-secondary" onClick={() => fileInput.current?.click()}>
              {file ? "更换全身照" : "选择全身照"}
            </button>
            <input ref={fileInput} type="file" accept={ACCEPT} hidden aria-label="穿搭全身照" onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }} />
            {file && <p className="k-card-meta" aria-live="polite">已选：{file.name}</p>}
            {error && <p className="k-error" role="alert">{error}</p>}
            <div><button type="submit" className="k-btn k-btn-primary" disabled={busy}>{busy ? "上传中…" : "添加穿搭"}</button></div>
          </form>
        )}
    </section>
  );
}
