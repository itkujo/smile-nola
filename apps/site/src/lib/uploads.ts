/**
 * Upload handling for admin-supplied portfolio thumbnails.
 *
 * Storage philosophy: uploads live OUTSIDE the build output so a docker
 * rebuild never loses them. The same persistent volume that holds the
 * SQLite DB (SMILE_NOLA_DB_DIR, mounted as /data in prod) also holds
 * an `uploads/portfolio/` subdirectory.
 *
 * Serving: a dedicated Astro route at /uploads/portfolio/[filename]
 * streams these files back at request time. We never put them under
 * /public/ because that directory is baked into the build.
 *
 * Processing: Sharp resizes every upload to 1280×720 cover-fit JPEG
 * quality 85 — predictable card thumbnails (~80–150 KB) regardless of
 * what the admin uploads.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getEnv } from "@/lib/env";

const DATA_DIR =
  getEnv("SMILE_NOLA_DB_DIR") ||
  path.resolve(process.cwd(), "..", "..", "data");

export const UPLOAD_DIR = path.join(DATA_DIR, "uploads", "portfolio");

/** Cap on raw inbound upload size. Anything above this is rejected. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/**
 * Resize and save a portfolio thumbnail.
 *
 * @param itemId   Portfolio item id — used as the filename, so replacing the
 *                 thumbnail for an existing item overwrites cleanly.
 * @param buffer   Raw file bytes from the multipart upload.
 * @returns The public URL the DB should store, including a cache-buster.
 */
export async function savePortfolioThumbnail(
  itemId: number,
  buffer: Buffer,
): Promise<string> {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const filename = `${itemId}.jpg`;
  const outPath = path.join(UPLOAD_DIR, filename);

  // cover-fit to 1280×720 (16:9) — matches portfolio card aspect ratio.
  // Withoutenlargement: false means we'll upscale tiny images. The 5 MB cap
  // means in practice everything fits.
  await sharp(buffer)
    .rotate() // honour EXIF orientation
    .resize(1280, 720, { fit: "cover", position: "centre" })
    .jpeg({ quality: 85, progressive: true, mozjpeg: true })
    .toFile(outPath);

  // Cache-buster from the file's mtime so the browser refetches after a
  // replacement upload even though the filename is stable.
  const stat = fs.statSync(outPath);
  return `/uploads/portfolio/${filename}?v=${stat.mtimeMs.toFixed(0)}`;
}

/**
 * Validate that an incoming File looks like an image we accept.
 * Returns null on success or an error message string on failure.
 */
export function validateThumbnailUpload(file: File): string | null {
  if (!file || file.size === 0) return "Thumbnail file is empty";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Thumbnail too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`;
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return `Thumbnail must be JPEG, PNG, or WebP (got ${file.type || "unknown"})`;
  }
  return null;
}

/** Resolve a stored filename back to its absolute disk path, with
 *  path-traversal protection. Returns null if the request is unsafe or the
 *  file does not exist on disk. */
export function resolveThumbnailPath(filename: string): string | null {
  // Strip any path component — only allow a bare filename.
  const safe = path.basename(filename);
  if (safe !== filename) return null;
  // Only allow our generated <id>.jpg pattern.
  if (!/^\d+\.jpg$/.test(safe)) return null;
  const full = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(full)) return null;
  return full;
}
