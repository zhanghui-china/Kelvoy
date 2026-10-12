const FAQ = [
  { q: "需要自己准备角色或实地拍摄吗？", a: "不需要。可以直接使用官方角色和目的地库里的实景参考图；也可以创建自己的角色。人物与场景参考图会用于关键帧或直出视频生成。" },
  { q: "每张候选图都需要挑选吗？", a: "默认的关键帧流程会为每镜生成候选图，需要逐镜选一张。创建时选择人物与场景直出视频，则跳过图片生成与关键帧审核。" },
  { q: "可以用真人照片做角色吗？", a: "可以上传照片创建角色。上传者需要确认照片的使用权及肖像授权。" },
  { q: "成片会带 AI 标识吗？", a: "会。成片包含 AI 生成标识及相应文件元数据。" },
  { q: "能直接发布到视频平台吗？", a: "平台入口只会打开对应网站，不会代你发布。你可以下载视频，再自行发布；也可以开启作品分享链接。" },
  { q: "如何获取账号？", a: "目前处于内测阶段，账号由团队预置开通。已有账号可直接登录。" },
];

export default function LandingFaq() {
  return (
    <section id="faq" className="k-lp-section k-lp-faq">
      <div className="k-lp-section-head k-lp-section-head-center"><span className="k-lp-section-tag">常见问题</span><h2>你可能还想知道</h2></div>
      <div className="k-lp-faq-list">
        {FAQ.map((f) => (
          <article className="k-lp-faq-item" key={f.q}>
            <span className="k-lp-faq-q" aria-hidden="true">Q</span>
            <div><h3>{f.q}</h3><p>{f.a}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}
