const STEPS = [
  { title: "选择角色与目的地", desc: "使用官方角色和目的地即可开始；也可以创建自己的角色。" },
  { title: "生成并审核脚本", desc: "检查旅行顺序、人物行为与字幕短句，确认后进入视频生成。" },
  { title: "逐镜确认片段", desc: "人物与场景参考直接生成视频，逐镜确认长镜片段，每镜成片 3–6 秒。" },
  { title: "合成、下载与分享", desc: "设置字幕、配乐和转场，完成后下载视频或开启分享。" },
];

export default function LandingHow() {
  return (
    <section id="how" className="k-lp-section k-lp-how">
      <div className="k-lp-section-head k-lp-section-head-center">
        <span className="k-lp-section-tag">创作流程</span>
        <h2>从一个想法，到一条旅行 vlog</h2>
        <p>四个阶段，按自己的节奏完成与审核。</p>
      </div>
      <div className="k-lp-steps-grid">
        {STEPS.map((s, i) => (
          <article className="k-lp-step" key={s.title}>
            <div className="k-lp-step-no">{String(i + 1).padStart(2, "0")}</div>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </article>
        ))}
      </div>
      <p className="k-lp-how-note">也可在创建项目时选择传统关键帧流程，额外审核每镜候选图。</p>
    </section>
  );
}
