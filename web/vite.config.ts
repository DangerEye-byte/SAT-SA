import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxies /api to the FastAPI backend. Build: emits into satsa/api/static,
// which FastAPI serves at http://localhost:8000 (single port, fully offline).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  build: { outDir: "../satsa/api/static", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
