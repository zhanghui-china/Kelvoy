import { useState } from "react";

/**
 * 关键帧/片段/角色参考图/地标实景图都可能还没生成或还没上传——真实环境里
 * "文件不在"就是"还在生成中"的正常状态，不是错误，所以加载失败显示占位
 * 而不是破图。审片台、角色工作室、目的地库三处共用（M2-9 起）。
 */
export function AssetImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="k-media-missing">
        <div>{alt}</div>
        <div className="k-card-meta">文件未生成</div>
      </div>
    );
  }
  return (
    <figure className="k-figure">
      <img className="k-media" src={src} alt={alt} onError={() => setFailed(true)} />
      {caption && <figcaption className="k-card-meta">{caption}</figcaption>}
    </figure>
  );
}
