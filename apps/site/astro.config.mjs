// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
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
  integrations: [react()],
  site: "https://smile-nola.com",
  server: {
    host: true,
    // 4321 = Astro default. 3000 is taken by the booth intake's Next.js dev server.
    port: Number(process.env.PORT ?? 4321),
  },
  // Disable Astro's built-in checkOrigin CSRF guard.
  //
  // It rejects multipart/form-data POSTs when the Origin header doesn't match
  // the request URL. Behind Coolify's Traefik reverse proxy that ALWAYS
  // happens: the container receives http://10.0.x.x:3000 internally while
  // the browser sends Origin: https://smile-nola.com — never a match.
  //
  // We don't lose defense-in-depth: the admin area's actual CSRF protection
  // is the signed HMAC session cookie (lib/auth.ts) which is SameSite=Lax,
  // HttpOnly, and impossible to forge without ADMIN_SESSION_SECRET. The
  // public inquiry forms all post application/json which is exempt from
  // this check anyway.
  security: {
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: "auto",
  },
});
