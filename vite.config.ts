import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { defineConfig as defineVitestConfig } from "vitest/config";

export default defineConfig(
  defineVitestConfig({
    plugins: [react()],
    base: "/",
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
    },
  })
);