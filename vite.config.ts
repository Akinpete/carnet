import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Reads cloudflare.config.ts: the Worker serves /api/*, static assets the rest.
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      // The manifest lives in public/manifest.webmanifest (the share target joins it in M2).
      manifest: false,
      workbox: {
        // Precache the shell for instant open; /api is network-only (no runtime cache yet).
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
