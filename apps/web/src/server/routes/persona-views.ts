import {
  cancelViewsJob, createViewsJob, getPersona, getViewsJob, listViewsJobs, type CreateViewsJobResult,
} from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// ADR-0017 穿搭三视图：据全身照生成正 / 侧 / 背并拼成设定图。生成是异步 job（worker 领取、积分预留），
// 这里只创建 / 查询 / 取消 job；目标的 views_status 直接取自角色文档（pending → ready / failed），
// 没有单独的"采用"端点：生成成功即 ready 可用，重新生成失败或取消会还原旧三视图（store 负责）。
// 所有接口按 owner 校验；他人、官方与不存在的角色、他人的 job 一律 404。
const views = new Hono();

views.use("*", requireOwner);

type CreateError = Extract<CreateViewsJobResult, { ok: false }>["error"];

const CREATE_STATUS: Record<CreateError, 402 | 404 | 409 | 422> = {
  not_found: 404,
  outfit_not_found: 404,
  no_source: 409,
  already_ready: 409,
  job_active: 409,
  insufficient_credits: 402,
  invalid_persona: 422,
};

const CREATE_MESSAGE: Record<CreateError, string> = {
  not_found: "角色不存在",
  outfit_not_found: "穿搭不存在",
  no_source: "该穿搭没有全身照，无法生成三视图",
  already_ready: "三视图已生成；如需重新生成请传 regenerate: true",
  job_active: "该穿搭已有进行中的三视图任务（源图不同）",
  insufficient_credits: "积分不足，无法生成三视图",
  invalid_persona: "角色数据不满足三视图约束",
};

const OUTFIT_ID_PATTERN = /^[\w-]{1,64}$/;

type CreateBody = { outfit_id: string | null; regenerate: boolean };

/** outfit_id 缺省或 null 表示默认穿搭（角色自身的 refs[0]）；regenerate 缺省为 false。 */
function parseCreateBody(body: unknown): CreateBody | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { outfit_id = null, regenerate = false } = body as Record<string, unknown>;
  if (outfit_id !== null && (typeof outfit_id !== "string" || !OUTFIT_ID_PATTERN.test(outfit_id))) return null;
  if (typeof regenerate !== "boolean") return null;
  return { outfit_id, regenerate };
}

async function ownsPersona(ownerId: string, personaId: string): Promise<boolean> {
  const persona = await getPersona(personaId);
  return persona !== null && persona.owner_id === ownerId;
}

// body: { outfit_id?: string | null, regenerate?: boolean }
views.post("/:id/views", async (c) => {
  const body = parseCreateBody(await c.req.json().catch(() => null));
  if (!body) return c.json({ ok: false, error: "invalid_body" }, 400);
  const result = await createViewsJob({ persona_id: c.req.param("id"), owner_id: c.get("ownerId"),
    outfit_id: body.outfit_id, regenerate: body.regenerate });
  if (!result.ok) {
    return c.json({ ok: false, error: result.error, message: CREATE_MESSAGE[result.error] }, CREATE_STATUS[result.error]);
  }
  return c.json({ ok: true, job: result.job, repeated: result.repeated }, result.repeated ? 200 : 201);
});

views.get("/:id/views/jobs", async (c) => {
  const personaId = c.req.param("id");
  if (!await ownsPersona(c.get("ownerId"), personaId)) return c.json({ ok: false, error: "not_found" }, 404);
  return c.json({ ok: true, jobs: await listViewsJobs(personaId, c.get("ownerId")) });
});

// 同一角色下的 job 才可见：跨角色访问 job_id 与他人 job 一样返回 404。
views.get("/:id/views/jobs/:job_id", async (c) => {
  const job = await getViewsJob(c.req.param("job_id"), c.get("ownerId"));
  if (!job || job.persona_id !== c.req.param("id")) return c.json({ ok: false, error: "not_found" }, 404);
  return c.json({ ok: true, job });
});

views.post("/:id/views/jobs/:job_id/cancel", async (c) => {
  const existing = await getViewsJob(c.req.param("job_id"), c.get("ownerId"));
  if (!existing || existing.persona_id !== c.req.param("id")) return c.json({ ok: false, error: "not_found" }, 404);
  const result = await cancelViewsJob(existing.job_id, c.get("ownerId"));
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, result.error === "not_found" ? 404 : 409);
  }
  return c.json({ ok: true, job: result.job, repeated: result.repeated });
});

export default views;
