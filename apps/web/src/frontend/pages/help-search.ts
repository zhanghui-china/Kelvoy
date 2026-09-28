import { GUIDE_SECTIONS } from "../guide";

export type HelpAnchor = (typeof GUIDE_SECTIONS)[number]["id"]
  | "personas" | "destinations" | "templates" | "settings" | "credits" | "retries" | "faq";
export interface HelpSearchItem {
  id: HelpAnchor;
  title: string;
  group: "创作流程" | "资源与账户" | "问题处理";
  text: string;
}

export const HELP_SEARCH_ITEMS: readonly HelpSearchItem[] = [
  ...GUIDE_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    group: "创作流程" as const,
    text: [section.summary, ...section.steps, section.review].join(" "),
  })),
  { id: "personas", title: "角色怎么选", group: "资源与账户", text: "角色库切换官方角色，使用角色带入新建一期；原创角色需上传多视角参考图，帮助跨期保持形象一致。" },
  { id: "destinations", title: "目的地看什么", group: "资源与账户", text: "目的地库按名称搜索、按类型筛选，查看地标、实景参考、季节和行程，带入新建一期。" },
  { id: "templates", title: "模板如何搭配", group: "资源与账户", text: "模板库搜索或按类型筛选，查看骨架、调色、片头片尾和标题样式，带入新建一期。" },
  { id: "settings", title: "出片默认值", group: "资源与账户", text: "设置默认语气和传统关键帧方式每镜候选数。" },
  { id: "credits", title: "积分与流水", group: "资源与账户", text: "积分可用余额、任务预留、成功结算、失败退回与实际用量。" },
  { id: "retries", title: "失败、重试与积分", group: "问题处理", text: "我的作品可按作品名、角色、目的地搜索，按状态、地区、省份、季节筛选；后台生成失败后重新执行失败任务。已有产物与已通过镜头保留。脚本编辑、指令优化或重新生成；暂不支持 CSV/PDF 导出。片段审核首次报告坏镜免费重生成，其他操作可能增加实际积分。" },
  { id: "faq", title: "常见问题", group: "问题处理", text: "官方角色、横屏 16:9、关键帧候选图、分享链接与平台发布。" },
];

export function searchHelp(query: string): HelpSearchItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...HELP_SEARCH_ITEMS];
  return HELP_SEARCH_ITEMS.filter((item) =>
    `${item.title} ${item.text}`.toLocaleLowerCase().includes(needle));
}
