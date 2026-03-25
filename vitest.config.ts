import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // Force React (and react-dom) to load their development bundles in tests.
  // Without this, a shell NODE_ENV=production causes react/index.js to pick
  // the production CJS bundle, which omits React.act and breaks
  // @testing-library/react's renderHook/act helpers.
  define: {
    "process.env.NODE_ENV": JSON.stringify("test"),
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
