import { listPersonas } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

// FR-03: 角色列表，按 owner_id 过滤（§8 多租户隔离）。
const personas = new Hono();

personas.get("/", requireOwner, async (c) => {
  return c.json({ ok: true, personas: await listPersonas(c.get("ownerId")) });
});

export default personas;
