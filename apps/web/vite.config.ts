import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      strict: true,
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../../node_modules", import.meta.url)),
        fileURLToPath(new URL("../../packages/contracts", import.meta.url)),
      ],
      deny: [".env", ".env.*", "**/.data/**", "**/.git/**", "**/*.pem"],
    },
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
