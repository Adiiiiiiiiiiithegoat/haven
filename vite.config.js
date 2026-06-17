import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on the local network (reachable from a phone on the same Wi-Fi)
    port: 5173,
    proxy: {
      // Frontend calls /api/* → forwarded to the local proxy backend.
      "/api": "http://localhost:8787",
    },
  },
});
