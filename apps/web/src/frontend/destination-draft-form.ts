import type { DestinationDraftContent } from "@kelvoy/engine";
/** 表单控件的 DOM id：缺项列表据此把焦点送到对应输入框。 */
export const DRAFT_NAME_ID = "draft-name";
export const DRAFT_CITY_ID = "draft-city";
export const DRAFT_ADD_LANDMARK_ID = "draft-add-landmark";
export type LandmarkField = "name" | "best_time" | "must_keep" | "photos";
export function landmarkFieldId(landmarkId: string, field: LandmarkField): string {
  return `landmark-${landmarkId}-${field}`;
}

export interface MissingItem { label: string; targetId: string }

export function missingDestinationTargets(content: DestinationDraftContent): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!content.name.trim()) missing.push({ label: "景区名称", targetId: DRAFT_NAME_ID });
  if (!content.city.trim()) missing.push({ label: "城市", targetId: DRAFT_CITY_ID });
  if (!content.landmarks.length) missing.push({ label: "至少一个地标", targetId: DRAFT_ADD_LANDMARK_ID });
  content.landmarks.forEach((landmark, index) => {
    const prefix = `地标 ${index + 1}`;
    if (!landmark.name.trim()) missing.push({ label: `${prefix}：名称`, targetId: landmarkFieldId(landmark.id, "name") });
    if (!landmark.best_time.trim()) missing.push({ label: `${prefix}：最佳机位／时段`, targetId: landmarkFieldId(landmark.id, "best_time") });
    if (!landmark.must_keep?.some(item => item.trim())) missing.push({ label: `${prefix}：必须保真的特征`, targetId: landmarkFieldId(landmark.id, "must_keep") });
    if (landmark.refs.length < 3 || landmark.refs.length > 10) missing.push({ label: `${prefix}：3–10 张实景照片`, targetId: landmarkFieldId(landmark.id, "photos") });
  });
  return missing;
}
export function missingDestinationItems(content: DestinationDraftContent): string[] {
  return missingDestinationTargets(content).map(item => item.label);
}
export function photoSelectionError(files: ReadonlyArray<{ size: number; type: string }>, current: number): string | null {
  if (current + files.length > 10) return "每个地标最多 10 张照片。";
  if (files.some(file => file.size > 10 * 1024 * 1024)) return "每张照片最多 10MB。";
  if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) return "请选择 JPEG、PNG 或 WebP 照片。";
  return null;
}
export function destinationDraftError(error?: string, message?: string): string {
  if (message) return message;
  const messages: Record<string, string> = {
    network_error: "网络连接失败，请重试。若发布请求中断，请重新加载确认发布结果。",
    invalid_response: "服务响应异常，请重试。",
    invalid: "输入不完整或格式不正确，请核对景区资料及照片。",
    invalid_content: "景区资料不完整或格式不正确，请核对输入。",
    invalid_image: "照片格式不正确或文件损坏，请换一张 JPEG、PNG 或 WebP 照片。",
    conflict: "草稿已有更新，请重新加载后核对。",
    unauthorized: "登录会话已过期，请重新登录。",
    not_found: "草稿不存在，或当前账号无权访问。",
    request_too_large: "上传超过请求大小限制，请减少本次照片数量。",
    invalid_path: "照片路径无效，请重新加载草稿。",
    internal_error: "服务暂时无法完成操作，请重试。",
    too_large: "上传超过大小限制，请减少照片数量并确保每张不超过 10MB。",
    photo_limit: "每个地标最多 10 张照片。",
  };
  return messages[error ?? ""] ?? "操作失败，请重试；持续失败时请联系管理员。";
}
export function canEditSharedDestination(creatorId?: string | null, userId?: string): boolean {
  return !!creatorId && !!userId && creatorId === userId;
}
