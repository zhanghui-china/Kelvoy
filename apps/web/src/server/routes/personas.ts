import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { validateCreatePersonaRequest, validatePersonaPatchRequest } from "@kelvoy/engine";
import type { Persona } from "@kelvoy/engine";
import { getPersona, insertPersona, listPersonas, updatePersona } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-03: 角色 CRUD + 参考图上传，按 owner_id 过滤（§8 多租户隔离）。
const personas = new Hono();

personas.use("*", requireOwner);

personas.get("/", async (c) => {
  return c.json({ ok: true, personas: await listPersonas(c.get("ownerId")) });
});

personas.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = validateCreatePersonaRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const persona: Persona = {
    persona_id: `c_${crypto.randomUUID()}`,
    owner_id: c.get("ownerId"),
    version: 1,
    refs: [], // 参考图走 POST /:id/refs 单独上传，3–7 张的校验在那一条路径上做
    ...result.value,
  };
  await insertPersona(persona);
  return c.json({ ok: true, persona }, 201);
});

personas.patch("/:id", async (c) => {
  const personaId = c.req.param("id");
  const current = await getPersona(personaId);
  if (!current || current.owner_id !== c.get("ownerId")) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const result = validatePersonaPatchRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const updated = await updatePersona(personaId, result.value);
  if (!updated.ok) return c.json({ ok: false, error: updated.error }, 404);
  return c.json({ ok: true, persona: updated.persona });
});

// 参考图落盘路径，和 apps/web/src/server/routes/episodes.ts 的
// projectsRoot() 同一套约定（PROJECTS_ROOT 环境变量 + 4 行拼接），两个路由
// 文件各自留一份而不是抽公共模块——episodes.ts 已经为同样的理由（不跨 app
// 导入 apps/worker）这么做了，这里是同一个取舍，不是新发明。
function projectsRoot(): string {
  return process.env.KELVOY_PROJECTS_ROOT ?? "projects";
}

const MIN_REFS = 3;
const MAX_REFS = 7;
const MAX_REF_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

personas.post("/:id/refs", async (c) => {
  const personaId = c.req.param("id");
  const current = await getPersona(personaId);
  if (!current || current.owner_id !== c.get("ownerId")) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }

  const form = await c.req.formData().catch(() => null);
  const files = form?.getAll("files").filter((f): f is File => f instanceof File) ?? [];
  if (files.length === 0) {
    return c.json({ ok: false, error: "no_files" }, 400);
  }

  // 一次上传就要把最终总数落在 [3, 7] 内——refs 只有这一条写路径，没有
  // "先攒着、之后再校验"的中间态，简化了 FR-03 这条校验该在什么时机触发
  // 的问题（M2-4 issue 验收里"少于 3 张 / 超过 7 张"两条边界都在这里查）。
  const total = current.refs.length + files.length;
  if (total < MIN_REFS || total > MAX_REFS) {
    return c.json(
      {
        ok: false,
        error: "invalid_ref_count",
        message: `参考图总数必须在 ${MIN_REFS}–${MAX_REFS} 张之间（当前已有 ${current.refs.length} 张，本次上传 ${files.length} 张，合计 ${total} 张）`,
      },
      400,
    );
  }

  for (const file of files) {
    if (!(file.type in EXT_BY_MIME)) {
      return c.json({ ok: false, error: "invalid_file_type", message: `不支持的图片格式: ${file.type}` }, 400);
    }
    if (file.size > MAX_REF_BYTES) {
      return c.json({ ok: false, error: "file_too_large", message: `单张图片不能超过 ${MAX_REF_BYTES / 1024 / 1024}MB` }, 400);
    }
  }

  const dir = join(projectsRoot(), "persona", personaId);
  await mkdir(dir, { recursive: true });

  const newRefs: string[] = [];
  for (const file of files) {
    const relPath = join("persona", personaId, `${crypto.randomUUID()}${EXT_BY_MIME[file.type]}`);
    await Bun.write(join(projectsRoot(), relPath), file);
    newRefs.push(relPath);
  }

  const updated = await updatePersona(personaId, { refs: [...current.refs, ...newRefs] });
  if (!updated.ok) return c.json({ ok: false, error: updated.error }, 404);
  return c.json({ ok: true, persona: updated.persona }, 201);
});

export default personas;
