import * as path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

function apiPort(): string {
  return process.env.PORT?.trim() || "4317";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4318,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort()}`,
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4318,
    strictPort: true,
  },
});
