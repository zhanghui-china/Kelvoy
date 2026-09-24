import type { Template } from "@kelvoy/engine";
import { validateCreateTemplateRequest } from "@kelvoy/engine";
import { deleteTemplate, listTemplates, upsertTemplate } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-10: 官方模板 + 当前用户自建模板/建私有模板/删私有模板。"本人"这几条
// 天然需要身份，所以整条路由都挂 requireOwner，不做"未登录只看官方"的分支
// （issue 没要求，YAGNI）。
const templates = new Hono();

templates.use("*", requireOwner);

templates.get("/", async (c) => {
  return c.json({ ok: true, templates: await listTemplates(c.get("ownerId")) });
});

templates.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = validateCreateTemplateRequest(body);
  if (!result.valid) return c.json({ ok: false, errors: result.errors }, 400);

  const template: Template = {
    template_id: `t_${crypto.randomUUID()}`,
    owner_id: c.get("ownerId"),
    ...result.value,
  };
  await upsertTemplate(template);
  return c.json({ ok: true, template }, 201);
});

// 官方模板（owner_id null）或别人的私有模板一律 404——不泄露存在性，和
// episodes.ts 的 loadOwnedEpisode 一个风格：SQL 里带 owner_id 条件，路由
// 层不用先查一次再判断权限。
templates.delete("/:id", async (c) => {
  const deleted = await deleteTemplate(c.req.param("id"), c.get("ownerId"));
  if (!deleted) return c.json({ ok: false, error: "not_found" }, 404);
  return c.json({ ok: true });
});

export default templates;
