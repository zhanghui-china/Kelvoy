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
  landmark_ref_invalid: "这张地标参考图不可用：本镜没有地标、图片序号超出范围，或空镜不能选“不使用地标图”",
  destination_not_found: "目的地记录不存在",
  invalid_row_version: "请求缺少版本号，刷新后重试",
  invalid_body: "请求格式不对",
  invalid_instruction: "请填写 500 字以内的优化指令",
  storyboard_busy: "生成任务正在处理中，完成后可修改分镜",
  invalid_public_patch: "请检查画面描述：不能为空，且最多 2000 字；当前阶段需允许修改",
  invalid_fields: "请填写画面动作、关键帧描述与运动描述，并检查字段长度",
  invalid_scene: "场景已变化，请重新选择",
  invalid_landmark: "请重新选择目的地里的地标",
  invalid_request: "请检查分镜字段后重试",
  shot_not_found: "这一镜已被修改或删除，请刷新后重试",
  scene_not_found: "场景已变化，请重新选择",
  action_pending: "脚本任务正在处理，请等待完成",
  insufficient_credits: "积分不足，请联系团队发放额度",
  no_failed_task: "没有可重试的失败任务，页面会自动刷新",
  invalid_target: "这一镜当前不能重试，请刷新后再试",
  too_many_outfits: "穿搭已达 6 套上限，先删除一套再添加",
  outfit_not_found: "这套穿搭已不存在，请刷新后重试",
  outfit_not_ready: "这套穿搭的三视图还没生成完成，请等待或换一套穿搭",
  invalid_ref_count: "图片数量不符：角色基础参考图 1–7 张；三视图穿搭只需 1 张全身照，旧式穿搭 1–3 张",
  invalid_file_type: "只支持 PNG / JPG / WebP 图片",
  file_too_large: "单张图片不能超过 10MB",
  upload_too_large: "上传内容太大，请减少图片数量或压缩后重试",
  no_source: "这套穿搭没有全身照（旧式穿搭），无法生成三视图",
  already_ready: "三视图已经生成，如需重做请使用「重新生成」",
  job_active: "这套穿搭已有进行中的三视图任务，请先取消它",
  not_cancellable: "任务已结束，不能取消",
  invalid_persona: "角色数据不满足三视图要求，请联系团队",
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
