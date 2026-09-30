import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Default: dev proxies /api to the FastAPI backend; the build emits into satsa/api/static, which FastAPI
// serves at http://localhost:8000 (single port, fully offline).
// Mode "static" (npm run build:static): the hosted demo. No backend; it reads the snapshot captured by
// scripts/snapshot.mjs from public-static/ and builds into web/dist for any static host. See DEPLOY.md.
export default defineConfig(({ mode }) => mode === "static"
  ? {
      plugins: [react()],
      publicDir: "public-static",
      build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
    }
  : {
      plugins: [react()],
      server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
      build: { outDir: "../satsa/api/static", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
    });
