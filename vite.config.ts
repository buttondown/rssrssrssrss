import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { getFaqStructuredData } from "./src/lib/faqs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    {
      name: "faq-structured-data",
      transformIndexHtml: (html) =>
        html.replace(
          "<!-- faq-structured-data -->",
          `<script type="application/ld+json">${JSON.stringify(getFaqStructuredData())}</script>`,
        ),
    },
  ],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: { port: 3030 },
});
