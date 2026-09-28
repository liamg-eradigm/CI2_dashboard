import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the dashboard talks to the local API worker (wrangler dev on :8787)
// through this proxy, so requests stay same-origin exactly like production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.API_ORIGIN ?? "http://127.0.0.1:8787", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
