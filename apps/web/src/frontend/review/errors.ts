import { type ApiFail, isContentViolation, isScriptRuleViolation } from "../api/client";

// 审片台写路由回的 error 码 -> 中文。审片台是给人用的页面，不应该把
// below_min_shots 这种码直接甩到屏幕上。
const ERROR_LABELS: Record<string, string> = {
  version_conflict: "期已被更新，正在刷新",
  illegal_transition: "当前状态不允许这个操作",
  not_found: "找不到这一期或这一镜",
  below_min_shots: "已经是 24 镜下限了，不能再删",
  invalid_order: "镜序不合法：这个阶段不能重排，或者顺序不是一个完整排列",
  landmark_reference: "这个地标不在目的地库里",
  destination_not_found: "目的地记录不存在",
  invalid_row_version: "请求缺少版本号，刷新后重试",
  invalid_body: "请求格式不对",
  invalid_instruction: "请填写 500 字以内的优化指令",
  action_pending: "脚本任务正在处理，请等待完成",
  network_error: "网络不通，稍后再试",
  invalid_response: "服务端返回了无法解析的内容",
};

/** 把一次失败的写请求翻成一句能贴到 role="alert" 里的中文。 */
export function describeWriteError(fail: ApiFail): string {
  if (fail.error === "content_blocked") {
    const hits = (fail.violations ?? [])
      .filter(isContentViolation)
      .map((v) => `${v.field}: ${v.term}`)
      .join("；");
    return `内容审核未通过，以下内容不允许出现：${hits}`;
  }
  if (fail.error === "script_rule_violation") {
    const messages = (fail.violations ?? [])
      .filter(isScriptRuleViolation)
      .map((v) => v.message)
      .join("；");
    return `不符合分镜规则（FR-02）：${messages}`;
  }
  if (Array.isArray(fail.errors) && fail.errors.length > 0) {
    return (fail.errors as string[]).join("；");
  }
  return ERROR_LABELS[fail.error ?? ""] ?? fail.message ?? fail.error ?? "操作失败";
}
