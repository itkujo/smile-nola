/**
 * Lightweight video URL parser + thumbnail resolver.
 *
 * Supports YouTube, Vimeo, and PicTime.
 *   • YouTube thumbnails come from the static img.youtube.com URL pattern
 *     (no API call needed).
 *   • Vimeo thumbnails come from the oEmbed JSON endpoint (one fetch on
 *     save; result cached in the portfolio_items row so we never call it
 *     on render).
 *   • PicTime: their URLs carry an opaque videoview access token. We store
 *     the full URL and render the iframe directly from it. No public
 *     thumbnail endpoint — falls back to the typographic placeholder.
 */

export type VideoProvider = "youtube" | "vimeo" | "pictime";

export interface ParsedVideo {
  provider: VideoProvider;
  embedId: string;
  /** Canonical embed URL (what we render <iframe src="..."> against). */
  embedUrl: string;
  /** Path under which the user-facing watch page lives. */
  watchUrl: string;
}

/* ============================================================================
 * URL parsing
 * ============================================================================ */

/** Returns null if the URL is unrecognized. */
export function parseVideoUrl(input: string): ParsedVideo | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // ---- YouTube ----------------------------------------------------------
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id ? youtubeOf(id) : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id ? youtubeOf(id) : null;
    }
    // /embed/<id>, /v/<id>, /shorts/<id>
    const match = url.pathname.match(/^\/(?:embed|v|shorts)\/([A-Za-z0-9_-]+)/);
    if (match) return youtubeOf(match[1]);
  }

  // ---- Vimeo ------------------------------------------------------------
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/<id> or vimeo.com/<id>/<hash> or vimeo.com/showcase/<showcase>/video/<id>
    const segs = url.pathname.split("/").filter(Boolean);
    let id: string | undefined;
    if (segs[0] === "video" && /^\d+$/.test(segs[1])) id = segs[1];
    else if (/^\d+$/.test(segs[segs.length - 1])) id = segs[segs.length - 1];
    else {
      // Try first numeric segment
      const numeric = segs.find((s) => /^\d+$/.test(s));
      if (numeric) id = numeric;
    }
    return id ? vimeoOf(id) : null;
  }

  // ---- PicTime ----------------------------------------------------------
  // Format: https://<sub>.pic-time.com/<gallery-slug>/featuredvideo/<id>?videoview=...&transparentbg=true
  // The videoview token in the query string is an opaque access token that
  // grants iframe-embed permission. We can't reduce the URL to an id alone;
  // store and render the full URL.
  if (host.endsWith(".pic-time.com") || host === "pic-time.com") {
    const segs = url.pathname.split("/").filter(Boolean);
    const featuredIdx = segs.indexOf("featuredvideo");
    if (featuredIdx >= 0 && featuredIdx + 1 < segs.length) {
      const id = segs[featuredIdx + 1];
      if (/^\d+$/.test(id)) {
        return pictimeOf(id, input.trim(), url);
      }
    }
  }

  return null;
}

function youtubeOf(id: string): ParsedVideo {
  return {
    provider: "youtube",
    embedId: id,
    embedUrl: `https://www.youtube.com/embed/${id}`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

function vimeoOf(id: string): ParsedVideo {
  return {
    provider: "vimeo",
    embedId: id,
    embedUrl: `https://player.vimeo.com/video/${id}`,
    watchUrl: `https://vimeo.com/${id}`,
  };
}

function pictimeOf(id: string, fullUrl: string, parsed: URL): ParsedVideo {
  // Watch URL = gallery base (drop /featuredvideo/<id> and the query string).
  // The user can navigate to the gallery if they want the full PicTime UX.
  const segs = parsed.pathname.split("/").filter(Boolean);
  const fvIdx = segs.indexOf("featuredvideo");
  const baseSegs = fvIdx > 0 ? segs.slice(0, fvIdx) : segs;
  const watchUrl = `${parsed.origin}/${baseSegs.join("/")}`;
  return {
    provider: "pictime",
    embedId: id,
    // Use the FULL original URL for the iframe src — the videoview token is
    // mandatory for the embed to load. Render-side code reads this back.
    embedUrl: fullUrl,
    watchUrl,
  };
}

/* ============================================================================
 * Thumbnail resolution
 * ============================================================================ */

/**
 * Resolve a thumbnail URL for the parsed video. YouTube uses the static URL
 * pattern. Vimeo calls oEmbed once. Failures return null — caller decides
 * whether to fall back to a typographic placeholder.
 */
export async function resolveThumbnail(parsed: ParsedVideo): Promise<string | null> {
  if (parsed.provider === "youtube") {
    // hqdefault is widely available (480×360). maxresdefault would be sharper
    // but isn't guaranteed for every video; hqdefault never 404s for a valid id.
    return `https://img.youtube.com/vi/${parsed.embedId}/hqdefault.jpg`;
  }

  if (parsed.provider === "vimeo") {
    try {
      const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(parsed.watchUrl)}`;
      const res = await fetch(oembedUrl, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = (await res.json()) as { thumbnail_url?: string };
      return data.thumbnail_url ?? null;
    } catch {
      return null;
    }
  }

  // PicTime has no public thumbnail endpoint we can reliably hit without
  // authentication. Falls back to the typographic placeholder on the cards.
  // Future: owner can manually upload a thumbnail via a future admin field.
  return null;
}
