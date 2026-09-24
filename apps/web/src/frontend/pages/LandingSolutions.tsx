// P0 用户三卡，逐字取 PRD §3"目标用户与 P0 场景"表的"用户 / 痛点 / 用产品
// 做什么"三列——不编新话术。第四行"旅行社 / OTA"是 P1，不放。
const USERS = [
  {
    user: "虚拟旅游博主 / faceless 旅行账号",
    pain: "要周更，人设跨期一致，人去不了那么多地方",
    solution: "一个角色每周去 3–5 个目的地各出一期",
  },
  {
    user: "文旅机构 / 目的地营销",
    pain: "缺素材缺人手，要覆盖辖区内多个景点并持续更新",
    solution: "一个「本地向导」角色，按目的地库批量出辖区景点系列",
  },
  {
    user: "服务文旅客户的代运营 / 广告工作室",
    pain: "拍摄成本高、交付慢、客户预算小",
    solution: "给每个客户建一个角色，持续交付目的地 vlog",
  },
];

export default function LandingSolutions() {
  return (
    <section id="solutions" className="k-lp-section">
      <div className="k-lp-section-head">
        <div className="k-eyebrow">产品定位</div>
        <h2>为什么不是一键生成</h2>
      </div>
      <p className="k-lp-section-lead">
        两条参考片验证了同一个方法：静帧锁一致性 + 1 秒一镜，能稳定出片——本质上都是同一个虚拟角色去不同地方。但我们不
        做通用 AI 视频生成器，也不做一键成片：参考片本身也是人挑出来的，批量出片同样逐期过三个审核点。角色是账号级资
        产，目的地是共享资产，叙事骨架模板 + 三个审核点让内容可信、成本可控。
      </p>
      <div className="k-lp-user-grid">
        {USERS.map((u) => (
          <div className="k-card k-lp-user-card" key={u.user}>
            <div className="k-card-title">{u.user}</div>
            <div className="k-lp-user-row">
              <span className="k-eyebrow">痛点</span>
              <p>{u.pain}</p>
            </div>
            <div className="k-lp-user-row">
              <span className="k-eyebrow">用 Kelvoy 做什么</span>
              <p>{u.solution}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
