import { Link } from "react-router-dom";
import type { DestinationType } from "@kelvoy/engine";
import { listDestinations } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";

const TYPE_LABEL: Record<DestinationType, string> = {
  mountain_summit: "名山登顶",
  city_night: "城市夜游",
  theme_town: "主题小镇",
  scenic_area: "大型景区",
  water_town: "古镇水乡",
  island: "海岛",
};

const TYPE_COLOR: Record<DestinationType, string> = {
  mountain_summit: "#8da9a5",
  city_night: "#22303a",
  theme_town: "#f0e2d0",
  scenic_area: "#e8eeec",
  water_town: "#e2eae8",
  island: "#d8e8ee",
};

const FEATURES = [
  { title: "固定虚拟角色", desc: "脸型、发型、体态跨期锁定，一个角色走遍所有目的地" },
  { title: "真实目的地库", desc: "每个地标 ≥ 3 张实景参考图，大佛比例、迎客松形态不出错" },
  { title: "三道人工审核", desc: "脚本、关键帧、片段各审一次，只做选择，不做剪辑" },
  { title: "30 秒竖屏成片", desc: "30 镜卡拍，自带 AI 标识，抖音 / 小红书 / 视频号可直接发" },
];

const STEPS = [
  { title: "选角色", desc: "用官方角色起步，或上传 3–7 张参考图建自己的角色" },
  { title: "选目的地和季节", desc: "骨架按目的地类型自动选：名山登顶、街区夜游、大型景区" },
  { title: "三道审核", desc: "改脚本、三选一关键帧、在片段里选 1 秒，每镜 10 秒" },
  { title: "导出与分享", desc: "下载 mp4 或分享链接，发布由你完成，AI 标识保留" },
];

export default function LandingPage() {
  const { data } = useApiResource(listDestinations, []);
  const destinations = data?.destinations ?? [];

  return (
    <div>
      <nav className="k-landing-nav">
        <span className="k-nav-brand">Kelvoy</span>
        <span className="k-nav-spacer" />
        <Link to="/login" className="k-btn k-btn-primary">
          登录
        </Link>
      </nav>

      <section className="k-hero">
        <div className="k-eyebrow">虚拟角色 × 真实目的地</div>
        <h1>让世界，跟着你的角色去旅行</h1>
        <p>
          定一个虚拟角色，选一个真实的地方——地标以实景参考图为准，人只在三个节点做选择，其余自动。每期 30 秒竖屏
          vlog。
        </p>
        <div>
          <Link to="/login" className="k-btn k-btn-primary">
            登录使用
          </Link>
        </div>
      </section>

      <div className="k-feature-strip">
        {FEATURES.map((f) => (
          <div className="k-feature-item" key={f.title}>
            <div className="k-feature-title">{f.title}</div>
            <div className="k-feature-desc">{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="k-section">
        <div className="k-section-head">
          <h2>热门目的地</h2>
          <span className="k-eyebrow" style={{ textTransform: "none" }}>
            官方维护，实景为准
          </span>
        </div>
        {destinations.length === 0 ? (
          <p className="k-empty">目的地库建设中，敬请期待。</p>
        ) : (
          <div className="k-dest-grid">
            {destinations.map((d) => (
              <div className="k-dest-card" key={d.destination_id}>
                <div className="k-dest-card-visual" style={{ background: TYPE_COLOR[d.type] }} />
                <div className="k-dest-card-body">
                  <div className="k-card-title">
                    {d.city} · {d.name}
                  </div>
                  <div className="k-card-meta">{TYPE_LABEL[d.type] ?? d.type}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="k-section">
        <div className="k-section-head">
          <h2>一期怎么做</h2>
        </div>
        <div className="k-steps-grid">
          {STEPS.map((s, i) => (
            <div className="k-step" key={s.title}>
              <div className="k-step-no">{String(i + 1).padStart(2, "0")}</div>
              <div className="k-feature-title" style={{ marginTop: "0.5rem" }}>
                {s.title}
              </div>
              <div className="k-feature-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="k-dark-banner">
        <div className="k-eyebrow" style={{ color: "#bdb6aa" }}>
          同一角色 · 不同目的地
        </div>
        <h2>一个角色，走遍你的每一站</h2>
        <p>角色是账号级资产：脸型、发型、体态跨期锁定，穿搭每期可换。三期下来观众记住的是人，不是滤镜。</p>
      </div>

      <footer className="k-footer">
        <span className="k-nav-brand">Kelvoy</span>
        <span>虚构角色 · 真实目的地</span>
      </footer>
    </div>
  );
}
