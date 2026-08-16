import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@molecvis/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts"),
    },
  },
  optimizeDeps: {
    // Ketcher resolves its Indigo worker relative to import.meta.url. Vite's
    // dependency optimizer rewrites that URL into .vite/deps without copying
    // the adjacent worker and WASM assets, which leaves the editor blank in
    // development. Let Vite serve these ESM packages from their real location.
    exclude: ["ketcher-standalone"],
    include: ["ketcher-core", "@babel/runtime/regenerator"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**"],
  },
});
