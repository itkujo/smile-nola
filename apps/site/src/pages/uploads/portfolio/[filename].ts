/**
 * GET /uploads/portfolio/<id>.jpg — serve admin-uploaded portfolio thumbnails.
 *
 * Files live OUTSIDE /public/ (see lib/uploads.ts for the storage rationale)
 * so we need a dedicated route to stream them. Path-traversal protection +
 * filename whitelist live in resolveThumbnailPath.
 */

import type { APIRoute } from "astro";
import fs from "node:fs";
import { resolveThumbnailPath } from "@/lib/uploads";

export const prerender = false;

export const GET: APIRoute = ({ params }) => {
  const filename = params.filename;
  if (typeof filename !== "string") {
    return new Response("Not found", { status: 404 });
  }

  const fullPath = resolveThumbnailPath(filename);
  if (!fullPath) {
    return new Response("Not found", { status: 404 });
  }

  const buf = fs.readFileSync(fullPath);
  const stat = fs.statSync(fullPath);

  // Filenames are stable per item id; cache-busting happens via the ?v=
  // query param we write into the DB. So we can cache aggressively here.
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Last-Modified": stat.mtime.toUTCString(),
    },
  });
};
