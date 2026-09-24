import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import assets from "./routes/assets";
import auth from "./routes/auth";
import destinations from "./routes/destinations";
import episodes from "./routes/episodes";
import health from "./routes/health";
import me from "./routes/me";
import personas from "./routes/personas";
import share from "./routes/share";
import templates from "./routes/templates";

const app = new Hono();

app.route("/api/health", health);
app.route("/api/auth", auth);
app.route("/api/me", me);
app.route("/api/personas", personas);
app.route("/api/destinations", destinations);
app.route("/api/templates", templates);
app.route("/api/episodes", episodes);
app.route("/api/share", share);
app.route("/api/assets", assets);

// No /internal HTTP layer (ADR-0004): apps/web and apps/worker share the
// same machine for now and both call packages/store directly.

// An /api/* path that didn't match any route above (typo, retired
// endpoint) must 404 as JSON, not fall through to the SPA fallback below —
// without this, Hono's routing hands unmatched /api/* requests to the
// wildcard static middleware same as any other unmatched path, and they'd
// silently get index.html back instead of a 404.
app.all("/api/*", (c) => c.json({ ok: false, error: "not_found" }, 404));

// M2-7: production static hosting for the Vite build (apps/web/dist).
// Registered after every /api/* route above — Hono composes matched
// handlers in registration order and an /api/* request is fully handled
// by its specific route (or the catch-all just above) before this wildcard
// middleware ever runs. In dev, Vite's own server (`dev:web`) serves the
// frontend directly and only proxies /api/* to this process (see
// vite.config.ts) — dist/ won't exist yet and that's fine, this process is
// never hit for non-API paths in dev.
app.use("/*", serveStatic({ root: "dist" }));
// SPA fallback: any GET that isn't a static asset or an /api/* route (i.e.
// a client-side route like /episodes/:id) gets index.html so react-router
// can take over.
app.get("*", serveStatic({ path: "dist/index.html" }));

export default {
  port: process.env.PORT ?? 3000,
  fetch: app.fetch,
};
