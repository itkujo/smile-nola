// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

/**
 * Smile NOLA marketing site.
 * SSR via Node adapter (standalone) so we can serve form endpoints, the
 * admin area, and the SQLite-backed inquiry store inside one Docker container.
 *
 * Tailwind v4 is wired through its first-class Vite plugin (the legacy
 * @astrojs/tailwind integration is for v3 and is not used here).
 */
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  site: "https://smile-nola.com",
  server: {
    host: true,
    // 4321 = Astro default. 3000 is taken by the booth intake's Next.js dev server.
    port: Number(process.env.PORT ?? 4321),
  },
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: "auto",
  },
});
