import { listDestinations } from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import "./LandingPage.css";
import LandingDestinations from "./LandingDestinations";
import LandingFaq from "./LandingFaq";
import LandingFeatures from "./LandingFeatures";
import LandingFooter from "./LandingFooter";
import LandingHero from "./LandingHero";
import LandingHow from "./LandingHow";
import LandingNav from "./LandingNav";
import LandingSolutions from "./LandingSolutions";

// 官网单页 + 锚点导航（#45 M2-17，取代 #38 的独立 Landing 页）。六个锚点各
// 对应一个 section，拆成同目录下的小组件文件是因为单文件塞不下（CLAUDE.md
// 单文件 ≤ 500 行）——LandingPage 本身只做数据获取（唯一动态数据：目的地
// 库）和组装，样式全在 LandingPage.css（.k-lp- 前缀），不放进 index.css：
// 官网跟工作台的排版体系不共用，混在一起只会让那个文件更难拆。#38 那套旧
// class 已随本次重写从 index.css 删除。
export default function LandingPage() {
  const { loading, data, error } = useApiResource(listDestinations, []);

  return (
    <div className="k-lp-page">
      <LandingNav />
      <LandingHero />
      <LandingSolutions />
      <LandingFeatures />
      <LandingHow />
      <LandingDestinations loading={loading} error={error} destinations={data?.destinations ?? []} />
      <LandingFaq />
      <LandingFooter />
    </div>
  );
}
