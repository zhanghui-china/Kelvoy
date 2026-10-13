import type { DestinationType } from "@kelvoy/engine";

// 地标表单两个必填项的填写提示。文案据实写：best_time 只存库和展示，不进任何 prompt；
// must_keep 只进脚本阶段 prompt（软约束），保真的硬依据是实景照片。别写成"能控制生成画面"。
export const BEST_TIME_HELP = "这个地标在哪个位置、什么时间拍最好看。写给你自己和审片的人，用来挑实景照；不会改变生成的画面。";
export const MUST_KEEP_HELP = "地标上不能被画走样的外观要点，每行一项。生成脚本时会参考它，真正的依据还是你上传的实景照。";
export const BEST_TIME_PLACEHOLDER = "例如：上午 9–11 点，山门正对，顺光";
export const MUST_KEEP_PLACEHOLDER = "每行一项，例如：\n右手施无畏印\n莲花座";

// 常用时段候选：点击才写入，绝不预填（预填会直接满足发布校验，用户可能不看就发布模板话）。
// 只给时段，不给机位和特征：机位与特征取决于具体地标，通用词必然不符。文案待产品审定。
export const BEST_TIME_SUGGESTIONS: Record<DestinationType, readonly string[]> = {
  mountain_summit: ["清晨日出前后", "上午顺光", "傍晚日落前侧光"],
  city_night: ["日落后蓝调时刻", "灯光全亮后", "深夜人少时"],
  theme_town: ["上午人少时", "下午柔和侧光", "傍晚亮灯后"],
  scenic_area: ["上午 9–11 点顺光", "午后侧光", "傍晚日落前"],
  water_town: ["清晨薄雾时", "下午侧光", "傍晚亮灯后"],
  island: ["上午海面平静时", "日落前后", "清晨日出前后"],
};

// best_time 与 DestinationDraft 校验同为 4000 字上限（schema/destination-draft.ts）。
const BEST_TIME_MAX = 4000;

/** 把候选追加到已有内容：空则直接写入；已含则不变；超长则不变。 */
export function appendBestTime(current: string, suggestion: string): string {
  const base = current.trim();
  if (!base) return suggestion;
  if (base.includes(suggestion)) return current;
  const next = `${base}；${suggestion}`;
  return next.length > BEST_TIME_MAX ? current : next;
}
