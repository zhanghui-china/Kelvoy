const PILLARS = [
  { no: "01", icon: "◉", title: "一个角色，持续出发", desc: "选用官方角色，或建立自己的角色。角色资料按版本保存，让不同作品沿用熟悉的人物形象。", example: "从第一条 vlog，到下一座城市" },
  { no: "02", icon: "◇", title: "让真实风景入镜", desc: "目的地库提供地标实景参考图。人物与场景参考可以直接用于视频生成，也可选择传统关键帧流程。", example: "有来源的地标参考，更好核对画面" },
  { no: "03", icon: "✓", title: "每一步都由你把关", desc: "先审脚本，再逐镜审核视频片段。发现人物、地标或动作问题，可以修改或重新生成。", example: "确认长镜片段，再进入合成设置" },
];

export default function LandingFeatures() {
  return (
    <section id="features" className="k-lp-feature-band">
      <div className="k-lp-section">
        <div className="k-lp-section-head k-lp-section-head-center">
          <span className="k-lp-section-tag">为什么选择可旅</span>
          <h2>你的角色，你的旅行叙事</h2>
          <p>保留人物和地点的线索，把创作的选择权留给你。</p>
        </div>
        <div className="k-lp-pillar-grid">
          {PILLARS.map((p) => (
            <article className="k-lp-pillar" key={p.no}>
              <span className="k-lp-pillar-no">{p.no}</span>
              <span className="k-lp-pillar-icon" aria-hidden="true">{p.icon}</span>
              <h3>{p.title}</h3>
              <p>{p.desc}</p>
              <div className="k-lp-pillar-example">{p.example}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
