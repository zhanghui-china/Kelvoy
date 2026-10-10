import { subtitlesEnabled } from "@kelvoy/engine";
import { useState } from "react";
import type { Destination, Episode, Persona } from "@kelvoy/engine";
import { assetUrl, episodeFileUrl } from "../api/client";
import { DESTINATION_TYPE_LABELS, SHOT_CAMERA_LABELS, SHOT_SIZE_LABELS, SHOT_STATUS_LABELS } from "../labels";
import { downloadScriptCsv } from "./scriptExport";
import type { StageId } from "./StageSteps";

/** Separate from review controls deliberately: this view has no mutation capability. */
function SavedMedia({ src, label, video = false }: { src: string; label: string; video?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="k-error" role="alert">{label}：{video ? "视频" : "图片"}加载失败</p>;
  return video
    ? <video className="k-media k-desk-final" src={src} controls preload="metadata" aria-label={label} onError={() => setFailed(true)} />
    : <img className="k-media" src={src} alt={label} onError={() => setFailed(true)} />;
}

function Fields({ values }: { values: [string, string | number][] }) {
  return <dl className="k-playback-fields">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === "" ? "未保存" : value}</dd></div>)}</dl>;
}

export default function StagePlayback({ stage, episode, destination, persona }: {
  stage: StageId; episode: Episode; destination: Destination | null; persona: Persona | null;
}) {
  const [pickedNo, setPickedNo] = useState<number | null>(null);
  const shot = episode.shots.find(s => s.no === pickedNo) ?? episode.shots[0];
  const file = (key: string) => episodeFileUrl(episode.episode_id, key);
  if (stage === "project") return <section className="k-desk-main">
    <article className="k-card"><h2>角色快照 · v{episode.persona_version}</h2>
      {persona ? <><Fields values={[["角色", persona.name], ["描述", persona.desc], ["固定特征", persona.locked.join("、")], ["默认服装", persona.default_outfit], ["调色", persona.style.lut], ["标题样式", persona.style.title_style]]} />
        <div className="k-desk-candidates">{persona.refs.map(ref => <SavedMedia key={ref} src={assetUrl(ref)} label={`${persona.name} 参考图`} />)}</div></>
        : <p className="k-empty">角色快照缺失 · {episode.persona_id}</p>}
    </article>
    <article className="k-card"><h2>目的地快照 · v{episode.destination_version}</h2>
      {destination ? <><Fields values={[["目的地", `${destination.city} · ${destination.name}`], ["类型", DESTINATION_TYPE_LABELS[destination.type]], ["介绍", destination.description ?? ""], ["最佳季节", destination.season_best.join("、")], ["路线", destination.route.join(" → ")], ["美食", destination.food.join("、")], ["交通", destination.transport], ["住宿", destination.stay]]} />
        {destination.landmarks.map(landmark => <details key={landmark.id}><summary>{landmark.name} · {landmark.best_time}</summary><div className="k-desk-candidates">{landmark.refs.map(ref => <SavedMedia key={ref} src={assetUrl(ref)} label={`${landmark.name} 实景参考`} />)}</div></details>)}</>
        : <p className="k-empty">目的地快照缺失 · {episode.destination_id}</p>}
    </article>
    <article className="k-card"><h2>已保存的创作设置</h2><Fields values={[
      ["作品名称", episode.name], ["季节", episode.brief.season], ["画幅", episode.brief.aspect], ["创作语气", episode.brief.tone],
      ["目标时长", `${episode.brief.duration_s} 秒`], ["创作要求", episode.brief.requirements], ["服装覆盖", episode.brief.outfit_override ?? "未设置"],
      ["禁止内容", episode.brief.banned.join("、")], ["生成模式", episode.mode === "grid" ? "网格" : "逐镜"],
      ["视频来源", episode.video_source === "references" ? "人物与场景参考图" : "关键帧"], ["每镜候选数", episode.candidate_count], ["模板", episode.template_id],
    ]} /></article>
  </section>;
  if (stage === "script") return <section className="k-desk-main">
    <div className="k-desk-toolbar"><h2>已保存的分镜脚本</h2><button type="button" className="k-btn k-btn-secondary" onClick={() => downloadScriptCsv(episode, destination)}>导出脚本 CSV</button></div>
    {!episode.shots.length ? <p className="k-empty">暂无已保存的脚本</p> : <div className="k-desk-tablewrap"><table className="k-desk-table">
      <thead><tr>{["镜号", "场景", "景别", "动作 beat", "字幕", "机位", "画面描述", "运动描述"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{episode.shots.map(s => <tr key={s.shot_id ?? s.no}><td>{s.no}</td><td>{episode.scenes.find(scene => scene.id === s.scene)?.name ?? s.scene}</td><td>{SHOT_SIZE_LABELS[s.size]}</td><td>{s.beat}</td><td>{s.caption || "—"}</td><td>{SHOT_CAMERA_LABELS[s.camera]}</td><td>{s.kf_prompt || "—"}</td><td>{s.motion_prompt || "—"}</td></tr>)}</tbody>
    </table></div>}
  </section>;
  if (stage === "keyframes") return <section className="k-desk-main"><h2>已保存的关键帧</h2>
    {episode.grid_refs.length > 0 && <details><summary>查看策划稿</summary><div className="k-desk-candidates">{episode.grid_refs.map(ref => <SavedMedia key={ref} src={file(ref)} label="网格策划稿" />)}</div></details>}
    {!episode.shots.length && <p className="k-empty">暂无已保存的图片</p>}
    {episode.shots.map(s => {
      const images = [...new Set([...s.candidates, ...(s.kf_selected ? [s.kf_selected] : [])])];
      return <article className="k-card" key={s.shot_id ?? s.no}><h3>第 {s.no} 镜 · {s.beat}</h3>
        <p className="k-card-meta">{s.kf_selected ? "已选图已标记" : "尚未选定图片"}</p>
        {images.length ? <div className="k-desk-candidates">{images.map(ref => <figure key={ref} className={`k-desk-candidate k-playback-candidate ${ref === s.kf_selected ? "is-selected" : ""}`}>
          <SavedMedia src={file(ref)} label={`第 ${s.no} 镜图片 ${ref}`} /><figcaption>{ref === s.kf_selected ? "已选图" : "候选图"} · {ref.split("/").pop()}</figcaption>
        </figure>)}</div> : <p className="k-empty">暂无已保存的图片</p>}
      </article>;
    })}</section>;
  if (stage === "clips") return <section className="k-desk-main"><h2>已保存的视频片段</h2>
    <div className="k-desk-focus-nav" role="group" aria-label="切换镜头">{episode.shots.map(s => <button key={s.no} type="button" className="k-btn k-btn-secondary k-btn-tiny" aria-pressed={s.no === shot?.no} onClick={() => setPickedNo(s.no)}>第 {s.no} 镜</button>)}</div>
    {shot ? <article className="k-card"><h3>第 {shot.no} 镜 · {shot.beat}</h3>
      <p className="k-card-meta">已保存的截取起点：{shot.trim_start_s === null ? "未保存（默认 0 秒）" : `${shot.trim_start_s.toFixed(2)} 秒`} · 审核状态：{SHOT_STATUS_LABELS[shot.status]}</p>
      <p className="k-card-meta">截取长度：{episode.cut_policy === "fixed_1s" ? 1 : shot.duration_s} 秒</p>
      {shot.clip ? <SavedMedia key={`${shot.no}:${shot.clip}`} src={file(shot.clip)} label={`第 ${shot.no} 镜视频`} video /> : <p className="k-empty">暂无已保存的视频</p>}
    </article> : <p className="k-empty">暂无已保存的视频</p>}
  </section>;
  return <section className="k-desk-main"><article className="k-card"><h2>已保存的合成设置</h2>
    <Fields values={[["成片标题", episode.render.title], ["分辨率", episode.render.res], ["帧率", `${episode.render.fps} fps`],
      ["字幕", subtitlesEnabled(episode.render) ? "开启" : "关闭"], ["转场", episode.render.transitions_enabled ? "开启" : "关闭"],
      ["配乐", episode.music.file || "自动选曲"], ["配乐节拍", `${episode.music.bpm} BPM`], ["片头", episode.render.intro ?? "无"], ["片尾", episode.render.outro ?? "无"],
      ["AI 标识", episode.render.ai_label ? "开启" : "关闭"], ["剪辑方式", episode.cut_policy === "fixed_1s" ? "每镜 1 秒" : "旧版节拍切点"]]} />
  </article>{episode.final ? <article className="k-card"><h2>{episode.final_needs_recompose || episode.status !== "done" ? "上一版成片 · 需要重新合成" : "已保存的成片"}</h2>
    <SavedMedia key={episode.final.key} src={file(episode.final.key)} label="已保存的成片" video /></article> : <p className="k-empty">暂无已保存的视频</p>}</section>;
}
