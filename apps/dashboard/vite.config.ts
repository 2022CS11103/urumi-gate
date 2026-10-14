import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    proxy: {
      "/api": { target: "http://127.0.0.1:43124", changeOrigin: true },
      "/mcp": { target: "http://127.0.0.1:43124", changeOrigin: true },
    },
  },
});
