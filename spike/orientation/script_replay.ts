// One-off (spike/, not linted or tested): does adding person/orientation rules to the script prompt change
// what the script LLM writes? Runs the deployed script provider twice per destination, the second time with the
// candidate rule block injected into the request body by a fetch wrapper (no source file is modified).
// Production DB is opened read-only; only StepFun is called.
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const RELEASE = process.env.RELEASE_DIR!;
for (const line of readFileSync("/home/huntun/.config/kelvoy/worker.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}
process.env.KELVOY_LLM_TIMEOUT_SECONDS = "120";
const RULES = `
人物镜头的构图与朝向（主人公是这支 vlog 的主角）：
- 除非创作要求另有说明，整期约一半以上的镜头应有主人公出镜（person_visible 为 true）；只有景物、美食、建筑细节、环境空镜才填 false。
- 有人物的镜头，kf_prompt 要写明：人物在画面中的位置与大小、身体朝向、视线落点、与本镜地标的空间关系；有 landmark 的镜头要在 kf_prompt 里用该地标的中文名称点名（如「灵山大佛」，不要写 id 如 lingshan_view），并让地标是主体或清晰可辨的背景（不能只写"远处山峦"）。kf_prompt 是给画图模型看的自然中文，不要出现 wide/medium/close/pov 等字段取值。
- 朝向由这一镜的剧情动作决定：仰望/眺望/登阶/走向/游览地标 → 背影或侧后方；触摸、品尝、与景物互动 → 侧面或四分之三侧面；打招呼、自我介绍、回眸、情绪收束 → 才可以面向镜头。不要默认写"面向镜头""看向镜头"。
- 如果第一镜有人物，必须同时可见该镜地标。
- motion_prompt 的动作要与朝向一致（背对镜头的人不要"转身看镜头"，除非这一镜的动作就是回眸）。
`;
const MARK = "\n每个元素字段：";
let inject = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  if (inject && init?.body && String(url).includes("/chat/completions")) {
    const body = JSON.parse(init.body);
    const msg = body.messages[0];
    if (!msg.content.includes(MARK)) throw new Error("rule insertion point not found");
    msg.content = msg.content.replace(MARK, `${RULES}${MARK}`);
    init = { ...init, body: JSON.stringify(body) };
  }
  return realFetch(url, init);
}) as typeof fetch;

const { stepfunScriptProvider } = await import(`${RELEASE}/packages/engine/src/providers/stepfun-llm`);
const db = new Database("/home/huntun/kelvoy/apps/web/data/kelvoy.db", { readonly: true });
const TRIALS = Number(process.env.TRIALS ?? "2");
const FACING = /面向镜头|看向镜头|面对镜头|正面|对着镜头|朝向镜头/;
const AWAY = /背对|背影|背向|侧身|侧面|侧后|四分之三|侧对/;

for (const id of (process.env.DESTS ?? "d_official_lingshan,d_official_nanchang").split(",")) {
  const destination = JSON.parse((db.query("select doc from destinations where destination_id=?").get(id) as any).doc);
  for (const [mode, on] of (process.env.MODES === "new" ? [["new", true]] : [["old", false], ["new", true]]) as [string, boolean][]) {
    for (let t = 1; t <= TRIALS; t++) {
      inject = on;
      const brief = { season: "秋", aspect: "9:16", requirements: "", duration_s: 30, tone: "松弛治愈", outfit_override: null, banned: ["私营店名", "可读文字"] };
      try {
        const { shots } = await stepfunScriptProvider.generateShots({ brief, destination, cutPolicy: "long_3_6" });
        const people = shots.filter((s: any) => s.person_visible !== false);
        const lmNames = destination.landmarks.map((l: any) => l.name);
        console.log(JSON.stringify({
          dest: id, mode, trial: t, shots: shots.length, with_person: people.length,
          person_ratio: +(people.length / shots.length).toFixed(2),
          facing_camera: people.filter((s: any) => FACING.test(s.kf_prompt)).length,
          away_or_side: people.filter((s: any) => AWAY.test(s.kf_prompt)).length,
          names_landmark: people.filter((s: any) => lmNames.some((n: string) => s.kf_prompt.includes(n))).length,
          first_shot_has_person: shots[0].person_visible !== false,
        }));
        if (t === 1) for (const s of shots) console.log(`  [${mode}] #${s.no} ${s.size}/${s.camera} lm=${s.landmark ?? "-"} p=${s.person_visible !== false ? 1 : 0} | ${s.kf_prompt} || ${s.motion_prompt}`);
      } catch (error: any) {
        console.log(JSON.stringify({ dest: id, mode, trial: t, error: String(error?.message).slice(0, 200) }));
      }
    }
  }
}
