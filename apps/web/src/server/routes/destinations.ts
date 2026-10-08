import { editDestinationDraft, DestinationDraftError, isPublishedDestinationAsset, listDestinations } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";
import { resolveAssetPath } from "./assets";
// Shared catalog: official resources and creator-published destinations.
const destinations = new Hono();
destinations.get("/", async (c) => {
    return c.json({ ok: true, destinations: await listDestinations() });
});
// Public marketing cards may only serve images referenced by this destination's
// catalog record. The authenticated /api/assets route remains the only path to
// persona references and episode artifacts.
destinations.get("/:id/assets/:path{.+}", async (c) => {
    const key = c.req.param("path");
    if (!key.startsWith("dest/"))
        return c.json({ ok: false, error: "invalid_path" }, 400);
    const filePath = resolveAssetPath(key);
    if (!filePath)
        return c.json({ ok: false, error: "invalid_path" }, 400);
    if (!await isPublishedDestinationAsset(key!, c.req.param("id"))) {
        return c.json({ ok: false, error: "not_found" }, 404);
    }
    const file = Bun.file(filePath);
    if (!(await file.exists()))
        return c.json({ ok: false, error: "not_found" }, 404);
    return new Response(file, { headers: { "Cache-Control": "public, max-age=3600" } });
});
destinations.post("/:id/edit", requireOwner, async (c) => {
    try {
        return c.json({ ok: true, draft: await editDestinationDraft(c.req.param("id")!, c.get("ownerId")) });
    }
    catch (error) {
        if (error instanceof DestinationDraftError)
            return c.json({ ok: false, error: error.code }, 404);
        throw error;
    }
});
export default destinations;
