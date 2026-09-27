const USERS = [
  { icon: "✦", user: "旅行内容创作者", pain: "有想讲的旅行故事，却不方便每次都出镜或实地拍摄。", solution: "让同一虚拟角色出现在不同目的地，逐期积累自己的旅行内容。" },
  { icon: "⌁", user: "文旅与目的地团队", pain: "景区素材丰富，持续制作有角色、有情节的短片却需要投入。", solution: "用实景参考图呈现地标，逐镜检查画面，再完成一条目的地故事。" },
  { icon: "▣", user: "内容工作室", pain: "不同项目需要各自的人物、场景和明确的交付流程。", solution: "按角色和目的地管理作品，审核脚本、片段与成片后再交付。" },
];

export default function LandingSolutions() {
  return (
    <section id="solutions" className="k-lp-section k-lp-solutions">
      <div className="k-lp-section-head k-lp-section-head-center">
        <span className="k-lp-section-tag">为旅行故事而生</span>
        <h2>把想去的地方，变成能分享的故事</h2>
        <p>从一个角色、一个目的地开始。创作中的每一步都由你决定。</p>
      </div>
      <div className="k-lp-user-grid">
        {USERS.map((u, i) => (
          <article className="k-lp-user-card" key={u.user}>
            <span className="k-lp-card-number">0{i + 1}</span>
            <span className="k-lp-user-icon" aria-hidden="true">{u.icon}</span>
            <h3>{u.user}</h3>
            <p>{u.pain}</p>
            <div className="k-lp-user-result">{u.solution}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
