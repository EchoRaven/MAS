/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const API_PROXY = { target: `http://127.0.0.1:${process.env.MAS_PORT || "5190"}`, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // /api goes to the MAS Studio server (npm run server); every call needs its token
  // the server's data (runs, evaluations: tens of thousands of files, more every run) and the scratch folders are not
  // source: watching them ran the machine out of file watchers (ENOSPC) and stopped the dev server
  server: {
    port: parseInt(process.env.STUDIO_PORT || "5180"),
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": API_PROXY },
    watch: { ignored: ["**/.data/**", "**/.probe/**", "**/benchmarks/**", "**/dist/**", "**/examples/**"] },
  },
  // `vite preview` serves the built app for the public ngrok domain; the dev server stays local-only
  preview: { port: 5181, strictPort: true, host: "127.0.0.1", allowedHosts: ["mas-studio.ngrok.app"], proxy: { "/api": API_PROXY } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "react";
          if (id.includes("@xyflow")) return "flow";
          if (id.includes("@radix-ui") || id.includes("@floating-ui")) return "radix";
          if (id.includes("lucide-react")) return "icons";
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--experimental-sqlite", "--no-warnings=ExperimentalWarning"] } },
  },
});
