import { Hono } from "hono";
import { checkContent, validStoryboardPatch, type ShotDraft, type StoryboardEdit } from "@kelvoy/engine";
import { updateStoryboard } from "@kelvoy/store";
const storyboard = new Hono();
for (const operation of ["insert", "patch", "remove", "reorder"] as const) {
  const path = operation === "insert" ? "/:id/storyboard" : operation === "reorder" ? "/:id/storyboard/reorder" : operation === "remove" ? "/:id/storyboard/:shotId/remove" : "/:id/storyboard/:shotId";
  storyboard.on(operation === "patch" ? "PATCH" : "POST", path, async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Number.isInteger(body.row_version) || body.row_version < 1) return c.json({ok:false,error:"invalid_request"},400);
    let edit: StoryboardEdit;
    if (operation === "insert") {
      if (!validStoryboardPatch(body.shot, true) || (body.after_shot_id !== null && typeof body.after_shot_id !== "string")) return c.json({ok:false,error:"invalid_request"},400);
      edit = {type:"insert", after_shot_id:body.after_shot_id,shot:body.shot as ShotDraft,shot_id:`sh_${crypto.randomUUID()}`};
    } else if (operation === "patch") {
      if (!validStoryboardPatch(body.patch)) return c.json({ok:false,error:"invalid_request"},400);
      edit = {type:"patch",shot_id:c.req.param("shotId")!,patch:body.patch};
    } else if (operation === "remove") edit = {type:"remove",shot_id:c.req.param("shotId")!};
    else {
      if (!Array.isArray(body.order) || body.order.some((id: unknown) => typeof id !== "string")) return c.json({ok:false,error:"invalid_request"},400);
      edit = {type:"reorder",order:body.order};
    }
    const text = edit.type === "insert" ? edit.shot : edit.type === "patch" ? edit.patch : {};
    if (checkContent(Object.entries(text).filter(([, value]) => typeof value === "string").map(([field,value]) => ({field,text:value as string}))).length) return c.json({ok:false,error:"content_blocked"},400);
    const result = await updateStoryboard({episode_id:c.req.param("id")!,owner_id:c.get("ownerId"),row_version:body.row_version,edit});
    if (result.ok) return c.json(result);
    return c.json(result,result.error === "not_found" ? 404 : ["version_conflict","storyboard_busy"].includes(result.error) ? 409 : 400);
  });
}
export default storyboard;
