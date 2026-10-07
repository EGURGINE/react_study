import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? "/react_study/" : "/",
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/gallery": {
        target: "http://127.0.0.1:3002",
      },
      "/socket": {
        target: "ws://127.0.0.1:3002",
        ws: true,
        rewrite: () => "/ws",
      },
    },
  },
  build: { chunkSizeWarningLimit: 800 },
});
