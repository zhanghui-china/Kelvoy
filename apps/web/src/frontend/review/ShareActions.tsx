import { useEffect, useState } from "react";
import * as QRCode from "qrcode";
import type { Episode } from "@kelvoy/engine";
import { shareUrl } from "../api/client";

export default function ShareActions({ episode }: { episode: Episode }) {
  const [qr, setQr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const link = episode.share.enabled ? shareUrl(episode.share.slug) : null;
  const captions = episode.shots.map((shot) => shot.caption?.trim()).filter(Boolean).slice(0, 3);
  const copy = [episode.render.title || episode.name, ...captions, "AI 生成 · 虚构角色 · 真实目的地", link]
    .filter(Boolean).join("\n");

  useEffect(() => {
    if (!link) { setQr(null); return; }
    let active = true;
    QRCode.toDataURL(link, { width: 196, margin: 2, errorCorrectionLevel: "M" })
      .then((image) => { if (active) setQr(image); })
      .catch(() => { if (active) setQr(null); });
    return () => { active = false; };
  }, [link]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(`${label}已复制`);
    } catch {
      setFeedback("复制失败，请手动选择文本复制");
    }
  }

  return <div className="k-share-actions">
    <p className="k-card-meta">可复制文案或链接；抖音和小红书按钮只打开网站，平台发布需要自行完成。</p>
    <div className="k-desk-actions">
      <button type="button" className="k-btn k-btn-secondary" onClick={() => void copyText(copy, "分享文案")}>复制文案</button>
      {link && <button type="button" className="k-btn k-btn-secondary" onClick={() => void copyText(link, "链接")}>复制链接</button>}
      <a className="k-btn k-btn-secondary" href="https://creator.douyin.com/" target="_blank" rel="noopener noreferrer">打开抖音创作者中心</a>
      <a className="k-btn k-btn-secondary" href="https://www.xiaohongshu.com/" target="_blank" rel="noopener noreferrer">打开小红书</a>
    </div>
    {feedback && <p role="status" className="k-card-meta">{feedback}</p>}
    {link && <div className="k-share-qr">
      {qr ? <img src={qr} width={196} height={196} alt="微信扫码查看作品分享页" /> : <span>二维码生成中…</span>}
      <p className="k-card-meta">用微信扫码打开作品页，再转发给好友。</p>
    </div>}
  </div>;
}
