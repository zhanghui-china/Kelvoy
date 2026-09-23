import { listTemplates } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-10: 官方模板 + 当前用户自建模板。"本人"这半边天然需要身份，所以整条
// 路由都挂 requireOwner，不做"未登录只看官方"的分支（issue 没要求，YAGNI）。
const templates = new Hono();

templates.get("/", requireOwner, async (c) => {
  return c.json({ ok: true, templates: await listTemplates(c.get("ownerId")) });
});

export default templates;
