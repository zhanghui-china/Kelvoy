import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      // Hono API (src/server), run separately via `bun run dev:api`.
      "/api": "http://localhost:3000",
    },
  },
});
