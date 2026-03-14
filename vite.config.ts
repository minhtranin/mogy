import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            "codemirror",
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/lang-javascript",
            "@codemirror/lang-json",
            "@codemirror/autocomplete",
            "@codemirror/theme-one-dark",
            "@replit/codemirror-vim",
          ],
          table: ["@tanstack/react-table"],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
