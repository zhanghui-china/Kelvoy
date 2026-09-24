import { DEFAULT_BLOCKLIST } from "./content-blocklist";

/**
 * MVP 内容审核关键词拦截 (PRD §8/§11 "内容滥用"对策，M1-14/#29)。
 * 纯函数，无 IO：脚本生成前（brief 里的用户输入）、脚本生成后（LLM 产出的
 * 分镜文案）都调这一份规则，命中即视为违规，不做语义判断——商业化阶段换
 * 云厂商内容安全 API（见 #35），这里只是过渡实现。
 */
export interface ContentViolation {
  field: string;
  term: string;
  category: string;
}

/** 关键词命中即拦截，区别于其它运行时错误。 */
export class ContentBlockedError extends Error {
  violations: ContentViolation[];

  constructor(violations: ContentViolation[]) {
    super(`内容审核未通过：${violations.map((v) => `${v.field} 含 "${v.term}"`).join("；")}`);
    this.name = "ContentBlockedError";
    this.violations = violations;
  }
}

// 大小写不敏感 + 去空白后再匹配，纯 substring，不引入分词库。
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/**
 * 对每段文本做关键词匹配，收集全部违规（不 fail fast，跟 rules/script.ts
 * 一致），命中返回全部，不命中返回空数组。
 */
export function checkContent(
  inputs: { field: string; text: string }[],
  blocklist: { category: string; terms: string[] }[] = DEFAULT_BLOCKLIST,
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const input of inputs) {
    const normalizedText = normalize(input.text);
    if (!normalizedText) continue;
    for (const { category, terms } of blocklist) {
      for (const term of terms) {
        if (normalizedText.includes(normalize(term))) {
          violations.push({ field: input.field, term, category });
        }
      }
    }
  }

  return violations;
}
