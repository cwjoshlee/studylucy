import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: ".",
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/client",
      filename: "sw.ts",
      injectRegister: false,
      manifest: {
        name: "수아의 공부방",
        short_name: "수아의 공부방",
        description: "한글 읽기와 초등 수학을 연습하는 수아의 공부방",
        lang: "ko-KR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "landscape",
        background_color: "#fffaf2",
        theme_color: "#2d7a62",
        icons: [
          {
            src: "/assets/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/assets/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      injectManifest: {
        globPatterns: [
          "assets/*-*.{js,css}",
          "assets/apple-touch-icon.png",
          "index.html"
        ]
      }
    })
  ],
  build: {
    outDir: "dist/client"
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
