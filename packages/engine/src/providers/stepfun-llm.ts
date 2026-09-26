import type { DestinationType } from "../schema/destination";
import type { Scene, SceneTime, Shot, ShotCamera, ShotSize } from "../schema/episode";
import { checkContent, ContentBlockedError } from "../rules/content";
import { checkScriptRules } from "../rules/script";
import { SKELETONS } from "../templates/skeletons";
import type { ScriptProvider } from "./types";

/**
 * 脚本 / 分镜 (PRD §7): StepFun 作为国内 API 候选（M0-4 已验证可用，见
 * spike/m0/eval/结论.md）。跟 local-llm.ts（自部署 Qwen3/DeepSeek）是同一份
 * ScriptProvider 接口的两个实现，选哪个由调用方（stage/CLI）决定，这里不做
 * 溢出判断（那是 providers/overflow.ts 的事）。
 */

const DEFAULT_BASE_URL = "https://api.stepfun.com/step_plan/v1";
const DEFAULT_MODEL = "step-3.5-flash";
const MAX_CORRECTION_ROUNDS = 3;

const SHOT_SIZES: ShotSize[] = ["wide", "medium", "close", "detail", "pov"];
const SHOT_CAMERAS: ShotCamera[] = ["static", "pan", "push", "follow"];
const SCENE_TIMES: SceneTime[] = ["morning", "noon", "afternoon", "evening", "night"];

interface RawShot {
  scene: string;
  time: SceneTime;
  size: ShotSize;
  beat: string;
  camera: ShotCamera;
  landmark: string | null;
  kf_prompt: string;
  motion_prompt: string;
}

function buildPrompt(input: {
  destinationType: DestinationType;
  destinationName: string;
  route: string[];
  landmarks: { id: string; name: string; must_keep?: string[] }[];
  food: string[];
  season: string;
  tone: string;
  requirements: string;
  aspect: string;
  banned: string[];
  feedback?: string;
}): string {
  const skeleton = SKELETONS[input.destinationType];
  const landmarkList = input.landmarks
    .map((l) => `${l.id}（${l.name}${l.must_keep?.length ? "，须保真：" + l.must_keep.join("/") : ""}）`)
    .join("；");

  return `你是旅行 vlog 分镜师。给下面这个目的地写一份 24-30 镜的分镜表，JSON 数组格式，不要任何 JSON 之外的文字。

目的地：${input.destinationName}（类型：${input.destinationType}）
动线：${input.route.join(" → ") || "无固定动线，自行安排"}
地标（landmark 字段必须填这里的 id，原样引用，不许编造新地标）：${landmarkList || "无"}
地方饮食：${input.food.join("、") || "无"}
季节：${input.season}　语气：${input.tone}
画幅：${input.aspect}
创作要求：${input.requirements || "无"}
禁止出现：${input.banned.join("、") || "无"}

叙事骨架（段落顺序参考，不用照抄段落名，用于把握节奏）：${skeleton.segments.join(" → ")}
镜头类型配比参考：地标 ${skeleton.shot_mix.landmark} / 美食 ${skeleton.shot_mix.food} / 人物动作 ${skeleton.shot_mix.action} / 氛围空镜 ${skeleton.shot_mix.atmosphere} / 转场 ${skeleton.shot_mix.transition}
${skeleton.notes}

硬规则：
- 24-30 镜
- 每镜一个动作 beat，不要塞多个动作
- 景别（size）不能连续超过 2 镜相同，size 只能是 wide/medium/close/detail/pov 之一
- 至少 5 镜的 landmark 字段非 null，且必须是上面给的 id
- camera 只能是 static/pan/push/follow 之一；time 只能是 morning/noon/afternoon/evening/night 之一，按段落推进順序递进
- 画面里不能出现可读文字、不能出现真人（vlog 角色除外，角色由后续阶段用参考图控制，这里的 kf_prompt 不用具体描述角色外貌）
- 不得出现政治、色情、暴力、违法、歧视内容及他人商标
- scene 字段填这一镜所属的段落名（同一段落内的镜头用完全相同的字符串，用于后续分组）

每个元素字段：scene, time, size, beat, camera, landmark, kf_prompt, motion_prompt。
kf_prompt 是关键帧图片生成的描述（中文，一句话，含光线/机位/动作，不含角色外貌细节）。
motion_prompt 是给视频阶段的运动提示（中文，一句话，只描述一个动作）。
${input.feedback ? `\n上一轮生成有以下问题，这一轮改正：\n${input.feedback}` : ""}`;
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("StepFun 返回里没找到 JSON 数组");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function parseRawShots(data: unknown): RawShot[] {
  if (!Array.isArray(data)) throw new Error("StepFun 返回的不是数组");
  return data.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new Error(`第 ${i + 1} 项不是对象`);
    const r = item as Record<string, unknown>;
    if (typeof r.scene !== "string" || !r.scene) throw new Error(`第 ${i + 1} 镜 scene 缺失`);
    if (!SCENE_TIMES.includes(r.time as SceneTime)) throw new Error(`第 ${i + 1} 镜 time "${r.time}" 不合法`);
    if (!SHOT_SIZES.includes(r.size as ShotSize)) throw new Error(`第 ${i + 1} 镜 size "${r.size}" 不合法`);
    if (typeof r.beat !== "string" || !r.beat) throw new Error(`第 ${i + 1} 镜 beat 缺失`);
    if (!SHOT_CAMERAS.includes(r.camera as ShotCamera)) throw new Error(`第 ${i + 1} 镜 camera "${r.camera}" 不合法`);
    if (r.landmark !== null && typeof r.landmark !== "string") throw new Error(`第 ${i + 1} 镜 landmark 字段类型不对`);
    if (typeof r.kf_prompt !== "string" || !r.kf_prompt) throw new Error(`第 ${i + 1} 镜 kf_prompt 缺失`);
    if (typeof r.motion_prompt !== "string" || !r.motion_prompt) throw new Error(`第 ${i + 1} 镜 motion_prompt 缺失`);
    return {
      scene: r.scene,
      time: r.time as SceneTime,
      size: r.size as ShotSize,
      beat: r.beat,
      camera: r.camera as ShotCamera,
      landmark: (r.landmark as string | null) ?? null,
      kf_prompt: r.kf_prompt,
      motion_prompt: r.motion_prompt,
    };
  });
}

// scenes 由 raw shots 里出现的 scene 名称分组得来：同名合并成一个 Scene，
// 顺序取第一次出现的顺序，time 取该组第一镜的 time。
function buildScenesAndShots(raw: RawShot[], durationTotal: number): { shots: Shot[]; scenes: Scene[] } {
  const sceneOrder: string[] = [];
  const sceneTimes = new Map<string, SceneTime>();
  const sceneLandmarks = new Map<string, Set<string>>();
  for (const r of raw) {
    if (!sceneOrder.includes(r.scene)) {
      sceneOrder.push(r.scene);
      sceneTimes.set(r.scene, r.time);
      sceneLandmarks.set(r.scene, new Set());
    }
    if (r.landmark) sceneLandmarks.get(r.scene)?.add(r.landmark);
  }
  const sceneIdByName = new Map(sceneOrder.map((name, i) => [name, `sc_${i + 1}`]));
  const scenes: Scene[] = sceneOrder.map((name) => ({
    id: sceneIdByName.get(name) as string,
    name,
    time: sceneTimes.get(name) as SceneTime,
    landmarks: [...(sceneLandmarks.get(name) ?? [])],
  }));

  const durationPerShot = Math.min(2, Math.max(0.8, durationTotal / raw.length));
  const shots: Shot[] = raw.map((r, i) => ({
    no: i + 1,
    scene: sceneIdByName.get(r.scene) as string,
    size: r.size,
    beat: r.beat,
    camera: r.camera,
    landmark: r.landmark,
    kf_prompt: r.kf_prompt,
    motion_prompt: r.motion_prompt,
    duration_s: durationPerShot,
    candidates: [],
    kf_selected: null,
    clip: null,
    trim_start_s: null,
    status: "draft",
    regen_stage: null,
    bad_shot_reported: false,
    model: {},
  }));

  return { shots, scenes };
}

// 生成后的关键词拦截（PRD §8/§11，#29）：LLM 产出的每镜文案都要过一遍，
// 命中的字段用"第 N 镜 xxx"当 field，方便直接拼进自动修正的 feedback。
function checkShotsContent(shots: Shot[]) {
  const inputs = shots.flatMap((shot) => [
    { field: `第 ${shot.no} 镜 beat`, text: shot.beat },
    { field: `第 ${shot.no} 镜 kf_prompt`, text: shot.kf_prompt },
    { field: `第 ${shot.no} 镜 motion_prompt`, text: shot.motion_prompt },
  ]);
  return checkContent(inputs);
}

async function callChatCompletion(prompt: string): Promise<string> {
  const apiKey = process.env.STEPFUN_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 STEPFUN_API_KEY");
  const baseUrl = process.env.STEPFUN_API_BASE ?? DEFAULT_BASE_URL;
  const model = process.env.STEPFUN_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    throw new Error(`StepFun 请求失败：${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("StepFun 返回里没有 content");
  return content;
}

export const stepfunScriptProvider: ScriptProvider = {
  async generateShots({ brief, destination }) {
    let feedback: string | undefined;
    let contentViolations: ReturnType<typeof checkShotsContent> = [];

    for (let round = 1; round <= MAX_CORRECTION_ROUNDS; round++) {
      const prompt = buildPrompt({
        destinationType: destination.type,
        destinationName: destination.name,
        route: destination.route,
        landmarks: destination.landmarks,
        food: destination.food,
        season: brief.season,
        tone: brief.tone,
        requirements: brief.requirements ?? "",
        aspect: brief.aspect,
        banned: brief.banned,
        feedback,
      });

      const content = await callChatCompletion(prompt);
      const raw = parseRawShots(extractJsonArray(content));
      const { shots, scenes } = buildScenesAndShots(raw, brief.duration_s);

      const ruleViolations = checkScriptRules(shots, destination);
      contentViolations = checkShotsContent(shots);
      if (ruleViolations.length === 0 && contentViolations.length === 0) {
        return { shots, scenes };
      }

      feedback = [
        ...ruleViolations.map((v) => `- ${v.message}`),
        ...contentViolations.map((v) => `- ${v.field} 含不允许出现的内容："${v.term}"`),
      ].join("\n");
    }

    if (contentViolations.length > 0) {
      throw new ContentBlockedError(contentViolations);
    }
    throw new Error(`脚本生成 ${MAX_CORRECTION_ROUNDS} 轮自动修正后仍不满足规则：\n${feedback}`);
  },
};
