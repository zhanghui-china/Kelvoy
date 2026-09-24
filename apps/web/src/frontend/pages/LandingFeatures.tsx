// §1"护城河不在模型，在角色资产、目的地库和跨期一致性"——三张卡各对应
// 一样，素材分别是 FR-03（角色）、FR-04（目的地库不允许无参考的想象地
// 标）、§8"质量红线"（三个人工审核点是唯一的质量把关）。
const PILLARS = [
  {
    title: "角色资产跨期一致",
    desc: "脸型、发型、体态锁定，角色是带版本号的账号级资产；每期可换穿搭，三期下来观众记住的是人，不是滤镜。",
  },
  {
    title: "真实目的地库",
    desc: "每个地标 ≥ 3 张实景参考图，地标镜头必须以库里的实景图为条件生成，不允许无参考的「想象地标」。",
  },
  {
    title: "三个人工审核点",
    desc: "脚本、关键帧、片段各审一次；人物漂移、手部崩坏、幻觉文字、地标失真——命中任一条该镜重生成，不进成片。",
  },
];

export default function LandingFeatures() {
  return (
    <section id="features" className="k-lp-section">
      <div className="k-lp-section-head">
        <div className="k-eyebrow">产品护城河</div>
        <h2>三样东西让 AI 旅行内容可信</h2>
      </div>
      <div className="k-lp-pillar-grid">
        {PILLARS.map((p) => (
          <div className="k-lp-pillar" key={p.title}>
            <div className="k-card-title">{p.title}</div>
            <p>{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
