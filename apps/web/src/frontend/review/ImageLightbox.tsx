import { useEffect, useId, useRef, useState } from "react";
import { AssetImage } from "../AssetImage";

export type LightboxItem = { src: string; alt: string; label: string; selected?: boolean };

/** Clamp, not wrap: wrapping hides that you have reached the first/last candidate. */
export function stepIndex(index: number, delta: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index + delta));
}

/**
 * 看大图：原生 modal dialog，焦点圈定、背景 inert、Esc 关闭、关闭后焦点回到触发
 * 按钮都由浏览器负责（同 DeleteEpisodeDialog）。只在打开时挂载。
 * 内部处理 ←/→ 并拦截冒泡，否则 useShotNavigation 的 window 监听会在灯箱下面切镜。
 */
export function ImageLightbox({ title, items, index, onIndexChange, onClose, onSelect, selectDisabled = false }: {
  title: string;
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 缺省时不显示选定按钮（参考图、只读回放）。 */
  onSelect?: (index: number) => void;
  selectDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  const current = items[index];
  if (!current) return null;
  const many = items.length > 1;

  function onKeyDown(event: React.KeyboardEvent) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onIndexChange(stepIndex(index, delta, items.length));
  }

  return (
    <dialog
      ref={ref}
      className="k-lightbox"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      // A click on the backdrop targets the dialog element itself.
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="k-lightbox-head">
        <h2 id={titleId} className="k-lightbox-title">
          {title} · {current.label}{many ? ` / ${items.length}` : ""}
          {current.selected ? " · 已选定" : ""}
        </h2>
        <button type="button" className="k-btn k-btn-secondary k-btn-tiny" autoFocus onClick={onClose}>关闭</button>
      </div>
      <div className="k-lightbox-stage">
        <AssetImage key={current.src} src={current.src} alt={current.alt} />
      </div>
      <div className="k-lightbox-actions">
        {many && (
          <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={index === 0}
            onClick={() => onIndexChange(stepIndex(index, -1, items.length))}>上一张</button>
        )}
        {many && (
          <button type="button" className="k-btn k-btn-secondary k-btn-tiny" disabled={index === items.length - 1}
            onClick={() => onIndexChange(stepIndex(index, 1, items.length))}>下一张</button>
        )}
        <span className="k-nav-spacer" />
        {onSelect && (
          <button type="button" className="k-btn k-btn-primary k-btn-tiny" aria-pressed={!!current.selected}
            disabled={selectDisabled || current.selected} onClick={() => onSelect(index)}>
            {current.selected ? "已选定" : "选这张"}
          </button>
        )}
      </div>
    </dialog>
  );
}

/** 单张图（参考图）：点击放大，灯箱里没有选定按钮。 */
export function ZoomImage({ src, alt, title }: { src: string; alt: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="k-desk-zoom" aria-label={`放大查看${alt}`} onClick={() => setOpen(true)}>
        <AssetImage src={src} alt={alt} />
      </button>
      {open && (
        <ImageLightbox title={title} items={[{ src, alt, label: "参考图" }]} index={0}
          onIndexChange={() => {}} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
