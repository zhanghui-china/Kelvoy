import { Hono } from "hono";
import destinations from "./routes/destinations";
import episodes from "./routes/episodes";
import health from "./routes/health";
import personas from "./routes/personas";
import share from "./routes/share";

const app = new Hono();

app.route("/api/health", health);
app.route("/api/personas", personas);
app.route("/api/destinations", destinations);
app.route("/api/episodes", episodes);
app.route("/api/share", share);

// No /internal HTTP layer (ADR-0004): apps/web and apps/worker share the
// same machine for now and both call packages/store directly.

// TODO: in production, serve the Vite build output (apps/web/dist) as
// static files here alongside the /api/* routes — not decided yet how
// dev-server (Vite) vs. prod (this Hono process) split the static serving.

export default {
  port: process.env.PORT ?? 3000,
  fetch: app.fetch,
};
