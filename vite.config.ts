import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Cross-parity tests import Artemis-Tracker's loadout core from the sibling
  // repo, so calc functions stay in sync. Node env, tests live beside sources.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },

  // Vite options tailored for Tauri development, applied in `tauri dev`/`tauri build`.
  clearScreen: false,
  server: {
    // Allow importing the sibling Artemis-Tracker repo (one level up) in tests.
    fs: { allow: [".."] },
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tauri locks the freshly-built exe during a rebuild; ignore the Rust output.
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
}));
