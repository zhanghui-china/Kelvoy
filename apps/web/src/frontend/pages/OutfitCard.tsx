import { type FormEvent, useState } from "react";
import { OUTFIT_REFS_MAX } from "@kelvoy/engine";
import type { Persona, PersonaOutfit } from "@kelvoy/engine";
import { AssetImage } from "../AssetImage";
import { assetUrl, deleteOutfit, patchOutfit, uploadOutfitRefs } from "../api/client";
import { describeWriteError } from "../review/errors";
import { parseSeasons } from "./outfit-helpers";
import ViewsPanel from "./ViewsPanel";

const ACCEPT = "image/png,image/jpeg,image/webp";

export default function OutfitCard({ persona, outfit, onSaved }: {
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
        {outfit.source
          ? <AssetImage src={assetUrl(outfit.source)} alt={`${outfit.name} 全身照`} caption="全身照" />
          : outfit.refs.map((ref, i) => <AssetImage key={ref} src={assetUrl(ref)} alt={`${outfit.name} 第 ${i + 1} 张`} />)}
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
            {!outfit.source && <label className={`k-btn k-btn-secondary k-btn-tiny${busy || outfit.refs.length >= OUTFIT_REFS_MAX ? " is-disabled" : ""}`}>
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
            </label>}
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
      <ViewsPanel persona={persona} outfit={outfit} onChange={onSaved} />
    </li>
  );
}
