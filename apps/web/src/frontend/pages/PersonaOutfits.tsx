import { type FormEvent, useState } from "react";
import { OUTFIT_REFS_MAX, OUTFIT_REFS_MIN, PERSONA_OUTFITS_MAX } from "@kelvoy/engine";
import type { Persona, PersonaOutfit } from "@kelvoy/engine";
import { AssetImage } from "../AssetImage";
import { assetUrl, createOutfit, deleteOutfit, patchOutfit, uploadOutfitRefs } from "../api/client";
import { describeWriteError } from "../review/errors";
import { parseSeasons } from "./outfit-helpers";

const ACCEPT = "image/png,image/jpeg,image/webp";

function OutfitCard({ persona, outfit, onSaved }: {
  persona: Persona; outfit: PersonaOutfit; onSaved: (persona: Persona) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(outfit.name);
  const [desc, setDesc] = useState(outfit.desc);
  const [seasons, setSeasons] = useState(outfit.seasons.join("、"));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(request: () => ReturnType<typeof deleteOutfit>, after?: () => void) {
    setBusy(true);
    setError(null);
    const result = await request();
    setBusy(false);
    if (!result.ok) {
      setError(describeWriteError(result));
      return;
    }
    after?.();
    onSaved(result.persona);
  }

  return (
    <li className="k-outfit-card">
      <div className="k-outfit-refs">
        {outfit.refs.map((ref, i) => <AssetImage key={ref} src={assetUrl(ref)} alt={`${outfit.name} 第 ${i + 1} 张`} />)}
      </div>
      {editing ? (
        <form className="k-outfit-edit" onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(() => patchOutfit(persona.persona_id, outfit.outfit_id,
            { name: name.trim(), desc, seasons: parseSeasons(seasons) }), () => setEditing(false));
        }}>
          <label className="k-field">名称<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required /></label>
          <label className="k-field">描述（可选）<input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} /></label>
          <label className="k-field">适合季节（用顿号分隔）
            <input value={seasons} onChange={(e) => setSeasons(e.target.value)} placeholder="例如：秋、冬" /></label>
          <div className="k-outfit-actions">
            <button type="submit" className="k-btn k-btn-primary k-btn-tiny" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
            <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy} onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      ) : (
        <>
          <div className="k-outfit-title">{outfit.name}</div>
          {outfit.desc && <div className="k-card-meta">{outfit.desc}</div>}
          <div className="k-outfit-seasons">
            {outfit.seasons.length > 0
              ? outfit.seasons.map((s) => <span className="k-pill" key={s}>{s}</span>)
              : <span className="k-card-meta">未标注季节</span>}
          </div>
          <div className="k-outfit-actions">
            <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy} onClick={() => setEditing(true)}>编辑</button>
            <label className={`k-btn k-btn-secondary k-btn-tiny${busy || outfit.refs.length >= OUTFIT_REFS_MAX ? " is-disabled" : ""}`}>
              追加图片（{outfit.refs.length}/{OUTFIT_REFS_MAX}）
              <input type="file" accept={ACCEPT} multiple hidden
                disabled={busy || outfit.refs.length >= OUTFIT_REFS_MAX}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length === 0) return;
                  if (outfit.refs.length + files.length > OUTFIT_REFS_MAX) {
                    setError(`每套穿搭最多 ${OUTFIT_REFS_MAX} 张图，还能追加 ${OUTFIT_REFS_MAX - outfit.refs.length} 张`);
                    return;
                  }
                  void run(() => uploadOutfitRefs(persona.persona_id, outfit.outfit_id, files));
                }} />
            </label>
            {confirming ? (
              <>
                <button type="button" className="k-btn k-btn-primary k-btn-tiny" disabled={busy}
                  onClick={() => void run(() => deleteOutfit(persona.persona_id, outfit.outfit_id))}>
                  {busy ? "删除中…" : "确认删除"}
                </button>
                <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
              </>
            ) : (
              <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={busy} onClick={() => setConfirming(true)}>删除</button>
            )}
          </div>
          {confirming && <p className="k-card-meta">已经用它建的作品不受影响，只是以后不能再选这套。</p>}
        </>
      )}
      {error && <p className="k-error" role="alert">{error}</p>}
    </li>
  );
}

/**
 * 角色编辑页的"穿搭"区块（ADR-0015）。独立于主表单：每次增删改都是一次即时保存，
 * 并让角色版本 +1，所以放在主 <form> 之外，不参与"保存修改"。
 */
export default function PersonaOutfits({ persona, onChange }: {
  persona: Persona; onChange: (persona: Persona) => void;
}) {
  const outfits = persona.outfits ?? [];
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [seasons, setSeasons] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = outfits.length >= PERSONA_OUTFITS_MAX;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (files.length < OUTFIT_REFS_MIN || files.length > OUTFIT_REFS_MAX) {
      setError(`请选择 ${OUTFIT_REFS_MIN}–${OUTFIT_REFS_MAX} 张这套穿搭的图片`);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createOutfit(persona.persona_id, { name: name.trim(), desc, seasons: parseSeasons(seasons), files });
    setBusy(false);
    if (!result.ok) {
      setError(describeWriteError(result));
      return;
    }
    setName(""); setDesc(""); setSeasons(""); setFiles([]);
    onChange(result.persona);
  }

  return (
    <section className="k-card k-outfits" aria-labelledby="k-outfits-title">
      <h2 id="k-outfits-title">穿搭 <span className="k-pill">{outfits.length} / {PERSONA_OUTFITS_MAX}</span></h2>
      <p className="k-card-meta">
        给同一个角色准备不同的穿搭，新建作品时按场景或季节选一套。每套需要这个角色穿这套衣服的
        {OUTFIT_REFS_MIN}–{OUTFIT_REFS_MAX} 张图（人像清晰、能看到上半身以上最好）；不选穿搭时用上面的参考图。
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
            <label className="k-btn k-btn-secondary">
              选择图片（{files.length}/{OUTFIT_REFS_MAX}）
              <input type="file" accept={ACCEPT} multiple hidden onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []).slice(0, OUTFIT_REFS_MAX));
                e.target.value = "";
              }} />
            </label>
            {files.length > 0 && <p className="k-card-meta">{files.map((f) => f.name).join("、")}</p>}
            {error && <p className="k-error" role="alert">{error}</p>}
            <div><button type="submit" className="k-btn k-btn-primary" disabled={busy}>{busy ? "上传中…" : "添加穿搭"}</button></div>
          </form>
        )}
    </section>
  );
}
