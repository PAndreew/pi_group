import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Include PDF.js compatibility polyfills for older Safari/mobile browsers.
      { find: /^pdfjs-dist$/, replacement: "pdfjs-dist/legacy/build/pdf.mjs" },
    ],
  },
  server: {
    host: true,
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
    },
  },
})
