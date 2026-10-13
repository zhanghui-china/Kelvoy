import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  OUTFIT_REFS_MAX, OUTFIT_REFS_MIN, validateCreateOutfitRequest, validateOutfitPatchRequest,
} from "@kelvoy/engine";
import type { PersonaOutfit } from "@kelvoy/engine";
import {
  addPersonaOutfit, appendOutfitRefs, getPersona, patchPersonaOutfit, removePersonaOutfit,
  type OutfitMutationError, type OutfitMutationResult,
} from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";
import { EXT_BY_MIME, MAX_REF_BYTES, parseBoundedMultipart, projectsRoot } from "./personas";

// 角色下的"穿搭"子分类：每套自带 1–3 张参考图，写入走角色版本 +1（见 store 的 mutateOutfits）。
// 与 personas.ts 同样按 owner 隔离；官方角色（owner_id null）没有 owner 匹配，天然只读。
const outfits = new Hono();

outfits.use("*", requireOwner);

const MAX_UPLOAD_BYTES = OUTFIT_REFS_MAX * MAX_REF_BYTES + 1024 * 1024;

const STATUS: Record<OutfitMutationError, 400 | 404 | 409> = {
  not_found: 404,
  outfit_not_found: 404,
  too_many_outfits: 409,
  invalid_ref_count: 400,
};

type Upload = { ok: true; files: File[] } | { ok: false; status: 400 | 413; body: Record<string, unknown>; form?: FormData };

function checkFiles(files: File[]): Upload {
  if (files.length < OUTFIT_REFS_MIN || files.length > OUTFIT_REFS_MAX) {
    return { ok: false, status: 400, body: { ok: false, error: "invalid_ref_count",
      message: `每套穿搭需要 ${OUTFIT_REFS_MIN}–${OUTFIT_REFS_MAX} 张图（本次 ${files.length} 张）` } };
  }
  for (const file of files) {
    if (!(file.type in EXT_BY_MIME)) {
      return { ok: false, status: 400, body: { ok: false, error: "invalid_file_type", message: `不支持的图片格式: ${file.type}` } };
    }
    if (file.size > MAX_REF_BYTES) {
      return { ok: false, status: 400, body: { ok: false, error: "file_too_large", message: `单张图片不能超过 ${MAX_REF_BYTES / 1024 / 1024}MB` } };
    }
  }
  return { ok: true, files };
}

async function readUpload(request: Request): Promise<Upload & { form?: FormData }> {
  const parsed = await parseBoundedMultipart(request, MAX_UPLOAD_BYTES);
  if (!parsed.ok) {
    return { ok: false, status: parsed.error === "upload_too_large" ? 413 : 400, body: { ok: false, error: parsed.error } };
  }
  const files = parsed.form.getAll("files").filter((f): f is File => f instanceof File);
  return { ...checkFiles(files), form: parsed.form };
}

/** Writes files first, then runs the DB mutation; files are removed again if it is refused or throws. */
async function storeAndCommit(
  personaId: string, files: File[], commit: (refs: string[]) => OutfitMutationResult,
): Promise<OutfitMutationResult> {
  await mkdir(join(projectsRoot(), "persona", personaId), { recursive: true });
  const refs: string[] = [];
  try {
    for (const file of files) {
      const rel = join("persona", personaId, `${crypto.randomUUID()}${EXT_BY_MIME[file.type]}`);
      refs.push(rel);
      await Bun.write(join(projectsRoot(), rel), file);
    }
    const result = commit(refs);
    if (!result.ok) await Promise.all(refs.map((r) => rm(join(projectsRoot(), r), { force: true })));
    return result;
  } catch (error) {
    await Promise.allSettled(refs.map((r) => rm(join(projectsRoot(), r), { force: true })));
    throw error;
  }
}

async function ownedPersonaId(ownerId: string, id: string): Promise<string | null> {
  const current = await getPersona(id);
  return current && current.owner_id === ownerId ? current.persona_id : null;
}

function outfitFields(form: FormData): Omit<PersonaOutfit, "outfit_id" | "refs"> | { errors: string[] } {
  const fields = validateCreateOutfitRequest({
    name: form.get("name"),
    desc: form.get("desc") ?? "",
    seasons: form.getAll("seasons").filter((v): v is string => typeof v === "string"),
  });
  return fields.valid ? fields.value : { errors: fields.errors };
}

// multipart: name, desc?, seasons?（可重复字段）, files（1–3 张）
outfits.post("/:id/outfits", async (c) => {
  const personaId = await ownedPersonaId(c.get("ownerId"), c.req.param("id"));
  if (!personaId) return c.json({ ok: false, error: "not_found" }, 404);
  const upload = await readUpload(c.req.raw);
  if (!upload.ok || !upload.form) return c.json(upload.ok ? { ok: false, error: "invalid_form" } : upload.body,
    upload.ok ? 400 : upload.status);
  const fields = outfitFields(upload.form);
  if ("errors" in fields) return c.json({ ok: false, errors: fields.errors }, 400);
  const outfit: Omit<PersonaOutfit, "refs"> = { outfit_id: `o_${crypto.randomUUID()}`, ...fields };
  const result = await storeAndCommit(personaId, upload.files, (refs) =>
    addPersonaOutfit({ persona_id: personaId, owner_id: c.get("ownerId"), outfit: { ...outfit, refs } }));
  if (!result.ok) return c.json({ ok: false, error: result.error }, STATUS[result.error]);
  return c.json({ ok: true, persona: result.persona, outfit: result.outfit }, 201);
});

// ADR-0017 三视图穿搭：只上传一张全身照，记作 source，refs 为空；之后由 persona-views 路由生成三视图。
// multipart: name, desc?, seasons?（可重复字段）, files（恰好 1 张）
outfits.post("/:id/outfits/source", async (c) => {
  const personaId = await ownedPersonaId(c.get("ownerId"), c.req.param("id"));
  if (!personaId) return c.json({ ok: false, error: "not_found" }, 404);
  const upload = await readUpload(c.req.raw);
  if (!upload.ok || !upload.form) return c.json(upload.ok ? { ok: false, error: "invalid_form" } : upload.body,
    upload.ok ? 400 : upload.status);
  if (upload.files.length !== 1) {
    return c.json({ ok: false, error: "invalid_ref_count", message: "全身照只需上传 1 张图" }, 400);
  }
  const fields = outfitFields(upload.form);
  if ("errors" in fields) return c.json({ ok: false, errors: fields.errors }, 400);
  const outfit: Omit<PersonaOutfit, "refs" | "source"> = { outfit_id: `o_${crypto.randomUUID()}`, ...fields };
  const result = await storeAndCommit(personaId, upload.files, ([source]) =>
    addPersonaOutfit({ persona_id: personaId, owner_id: c.get("ownerId"),
      outfit: { ...outfit, refs: [], source } }));
  if (!result.ok) return c.json({ ok: false, error: result.error }, STATUS[result.error]);
  return c.json({ ok: true, persona: result.persona, outfit: result.outfit }, 201);
});

outfits.patch("/:id/outfits/:outfit_id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const patch = validateOutfitPatchRequest(body);
  if (!patch.valid) return c.json({ ok: false, errors: patch.errors }, 400);
  const result = patchPersonaOutfit({ persona_id: c.req.param("id"), owner_id: c.get("ownerId"),
    outfit_id: c.req.param("outfit_id"), patch: patch.value });
  if (!result.ok) return c.json({ ok: false, error: result.error }, STATUS[result.error]);
  return c.json({ ok: true, persona: result.persona, outfit: result.outfit });
});

outfits.post("/:id/outfits/:outfit_id/refs", async (c) => {
  const personaId = await ownedPersonaId(c.get("ownerId"), c.req.param("id"));
  if (!personaId) return c.json({ ok: false, error: "not_found" }, 404);
  const upload = await readUpload(c.req.raw);
  if (!upload.ok) return c.json(upload.body, upload.status);
  const result = await storeAndCommit(personaId, upload.files, (refs) =>
    appendOutfitRefs({ persona_id: personaId, owner_id: c.get("ownerId"), outfit_id: c.req.param("outfit_id"), refs }));
  if (!result.ok) return c.json({ ok: false, error: result.error }, STATUS[result.error]);
  return c.json({ ok: true, persona: result.persona, outfit: result.outfit }, 201);
});

outfits.delete("/:id/outfits/:outfit_id", (c) => {
  const result = removePersonaOutfit({ persona_id: c.req.param("id"), owner_id: c.get("ownerId"),
    outfit_id: c.req.param("outfit_id") });
  if (!result.ok) return c.json({ ok: false, error: result.error }, STATUS[result.error]);
  return c.json({ ok: true, persona: result.persona });
});

export default outfits;
