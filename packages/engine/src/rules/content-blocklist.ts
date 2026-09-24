/**
 * MVP 关键词拦截种子词表 (PRD §8/§11 "内容滥用"对策，M1-14/#29)。
 *
 * 这是 prompt 层关键词拦截的最小实现，不是产品规则的最终形态——商业化阶段
 * 对外上线前会换成云厂商内容安全 API（文本 + 图片，见 #35），届时这份词表
 * 大概率整个下线。词表本身可以随时扩，扩词不算业务逻辑变更。
 */
export const DEFAULT_BLOCKLIST: { category: string; terms: string[] }[] = [
  {
    category: "politics",
    terms: ["台独", "藏独", "港独", "颠覆国家", "分裂国家", "六四"],
  },
  {
    category: "porn",
    terms: ["色情", "裸体", "全裸", "性爱", "做爱", "porn", "nude"],
  },
  {
    category: "violence",
    terms: ["血腥", "斩首", "虐杀", "自杀", "爆炸物", "gore"],
  },
  {
    category: "illegal",
    terms: ["贩毒", "毒品", "赌博", "枪支", "制毒", "洗钱"],
  },
  {
    category: "hate",
    terms: ["种族歧视", "地域歧视", "性别歧视", "残疾人歧视"],
  },
  {
    category: "brand",
    terms: ["耐克", "阿迪达斯", "香奈儿", "路易威登", "nike", "adidas"],
  },
];
