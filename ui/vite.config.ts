import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import vuetify from "vite-plugin-vuetify";

export default defineConfig({
  plugins: [
    vue(),
    vuetify(),
    VitePWA({
      filename: "service-worker.js",
      registerType: "prompt",
      workbox: {
        navigateFallbackDenylist: [/^\/auth\//],
      },
      includeAssets: [
        "img/icons/favicon.ico",
        "img/icons/apple-touch-icon.png",
        "img/icons/favicon-16x16.png",
        "img/icons/favicon-32x32.png",
      ],
      manifest: {
        name: "WUD",
        short_name: "WUD",
        theme_color: "#00355E",
        background_color: "#00355E",
        display: "standalone",
        icons: [
          {
            src: "img/icons/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "img/icons/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    server: {
      deps: {
        inline: ["vuetify"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.{js,vue,ts}"],
      exclude: [
        "src/main.ts",
        "src/registerServiceWorker.ts",
        "**/node_modules/**",
      ],
    },
    clearMocks: true,
  },
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
});
