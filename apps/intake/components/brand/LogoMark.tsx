/* eslint-disable @next/next/no-img-element */

interface Props {
  /** Pixel size of the rendered mark on the largest dimension. */
  size?: number;
  className?: string;
  /** Render only the camera/SN floral submark glyph. */
  submarkOnly?: boolean;
  /** Render only the Holimount script wordmark with PHOTO/VIDEO BOOTH subtitle. */
  wordmarkOnly?: boolean;
  /**
   * Color the mark via CSS mask. Pass any CSS color (var, hex, rgb).
   * Defaults to the brand gold token. Set to "gold-art" to use the
   * pre-colored gold SVG without masking (preserves any internal color
   * variations the artwork may carry).
   */
  color?: string | "gold-art";
  /** Optional soft amber glow drop-shadow. */
  glow?: boolean;
}

/**
 * Smile NOLA brand mark, served from public/logos/.
 *
 * Three artwork variants:
 *   • full   — submark + Holimount script + PHOTO/VIDEO BOOTH (default)
 *   • submark — camera/SN floral monogram only
 *   • wordmark — script + subtitle only, no submark
 *
 * Coloring strategy: each SVG is shipped as currentColor. We recolor by
 * applying CSS mask-image so we can use any token (gold, ivory, champagne)
 * and add filter glows without committing to a baked color in the file.
 *
 * Aspect ratios are preserved automatically.
 */
export function LogoMark({
  size = 200,
  className = "",
  submarkOnly = false,
  wordmarkOnly = false,
  color = "var(--sn-gold)",
  glow = false,
}: Props) {
  // Aspect ratios (width / height) from the official SVG viewBoxes.
  // submark: 1445×919 ≈ 1.57:1
  // wordmark: 3547×990 ≈ 3.58:1
  // full: 3487×1468 ≈ 2.37:1
  const aspect = submarkOnly
    ? 1445 / 919
    : wordmarkOnly
      ? 3547 / 990
      : 3487 / 1468;
  const width = Math.round(size * aspect);
  const height = size;

  const src = submarkOnly
    ? "/logos/icon.svg"
    : wordmarkOnly
      ? "/logos/wordmark.svg"
      : "/logos/full-logo.svg";

  // If user requested the pre-colored gold artwork, just render it directly.
  if (color === "gold-art") {
    return (
      <img
        src={src.replace("/full-logo.svg", "/full-logo-gold.svg")}
        alt="Smile NOLA"
        width={width}
        height={height}
        className={className}
        style={
          glow
            ? {
                filter:
                  "drop-shadow(0 0 24px rgba(255, 178, 63, 0.45)) drop-shadow(0 0 1px rgba(212, 175, 55, 0.6))",
              }
            : undefined
        }
      />
    );
  }

  // Mask-based recoloring: the SVG becomes the mask, we paint with `color`.
  // If `className` includes width/height utilities, they override our defaults.
  const overridden = /\b(w-|h-)/.test(className);
  return (
    <span
      role="img"
      aria-label="Smile NOLA"
      className={className}
      style={{
        display: "inline-block",
        ...(overridden ? {} : { width, height }),
        backgroundColor: color,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        filter: glow
          ? "drop-shadow(0 0 24px rgba(255, 178, 63, 0.4)) drop-shadow(0 0 1px rgba(212, 175, 55, 0.55))"
          : undefined,
      }}
    />
  );
}
