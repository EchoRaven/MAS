/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: parseInt(process.env.STUDIO_PORT || "5180"), strictPort: true, host: "127.0.0.1" },
  // `vite preview` serves the built app for the public ngrok domain; the dev server stays local-only
  preview: { port: 5181, strictPort: true, host: "127.0.0.1", allowedHosts: ["mas-studio.ngrok.app"] },
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
  test: { environment: "jsdom", globals: true, include: ["src/**/*.test.{ts,tsx}"] },
});
