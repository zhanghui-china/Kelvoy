// 展示新项目默认的人物＋场景直出流程；传统关键帧流程仍可在创建页选择。
const FLOW: { label: string; isGate?: boolean }[] = [
  { label: "Brief" },
  { label: "脚本" },
  { label: "审核 1", isGate: true },
  { label: "人物＋场景" },
  { label: "视频" },
  { label: "审核 2", isGate: true },
  { label: "合成" },
  { label: "成片" },
];

// #38 已有的"一期怎么做"四步改写：操作 ≤ 30 分钟是 §1 MVP 目标原文
// （"用户从 brief 到成片：操作 ≤ 30 分钟"）。
const STEPS = [
  { title: "建角色", desc: "用官方角色起步，或上传 3–7 张参考图建自己的角色" },
  { title: "选目的地", desc: "从目的地库选一个真实景区，季节、语气按需调整" },
  { title: "过两个审核点", desc: "检查脚本和视频，为每镜选定 1 秒片段；传统方式另需选关键帧" },
  { title: "导出与分享", desc: "下载 mp4 或分享链接，AI 标识保留" },
];

export default function LandingHow() {
  return (
    <section id="how" className="k-lp-section">
      <div className="k-lp-section-head">
        <div className="k-eyebrow">生产流程</div>
        <h2>人物与场景直出视频：两个审核点</h2>
      </div>
      <div className="k-lp-flow">
        {FLOW.map((f, i) => (
          <div className="k-lp-flow-item" key={f.label}>
            {i > 0 && <span className="k-lp-flow-arrow">→</span>}
            <span className={f.isGate ? "k-pill k-pill-accent" : "k-pill"}>{f.label}</span>
          </div>
        ))}
      </div>

      <div className="k-lp-section-head k-lp-how-substep-head">
        <h3>四步，30 分钟</h3>
      </div>
      <div className="k-lp-steps-grid">
        {STEPS.map((s, i) => (
          <div className="k-lp-step" key={s.title}>
            <div className="k-lp-step-no k-mono">{String(i + 1).padStart(2, "0")}</div>
            <div className="k-card-title">{s.title}</div>
            <p>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
