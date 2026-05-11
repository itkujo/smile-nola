/**
 * /sitemap.xml — public pages enumerated for search engines.
 * Admin and API routes are excluded.
 */

import type { APIRoute } from "astro";
import { COLLECTIONS } from "@/content/collections";

export const prerender = false;

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? "https://smile-nola.com";

  const now = new Date().toISOString().slice(0, 10);

  const urls = [
    { loc: "/",           changefreq: "weekly",  priority: "1.0" },
    { loc: "/collections", changefreq: "monthly", priority: "0.9" },
    ...COLLECTIONS.map((c) => ({
      loc: `/collections/${c.slug}`,
      changefreq: "monthly",
      priority: "0.85",
    })),
    { loc: "/portfolio",  changefreq: "weekly",  priority: "0.7" },
    { loc: "/about",      changefreq: "monthly", priority: "0.6" },
    { loc: "/contact",    changefreq: "monthly", priority: "0.6" },
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${origin}${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
