interface Props {
  size?: number;
  className?: string;
  /** When true, render only the camera/SN floral submark glyph */
  submarkOnly?: boolean;
}

/**
 * Brand wordmark placeholder.
 *
 * NOTE: Per Brand Brief §15, the official Smile NOLA logo artwork should be
 * used wherever possible (gold script). Until that file is provided, we use
 * a Broadway wordmark as a tasteful, on-brand stand-in. Replace this
 * component with an <Image src="/logo-gold.svg" /> once artwork is in hand.
 */
export function LogoMark({
  size = 48,
  className = "",
  submarkOnly = false,
}: Props) {
  if (submarkOnly) {
    // Geometric monogram: SN inside a thin gold ring with deco accents.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="Smile NOLA"
      >
        <circle
          cx="24"
          cy="24"
          r="22"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.6"
        />
        <circle
          cx="24"
          cy="24"
          r="20"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <text
          x="24"
          y="29"
          textAnchor="middle"
          fontFamily="var(--font-deco)"
          fontSize="14"
          fill="currentColor"
          letterSpacing="2"
        >
          SN
        </text>
        <path
          d="M11 12 L9 12 L9 14"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.7"
        />
        <path
          d="M37 36 L39 36 L39 34"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.7"
        />
      </svg>
    );
  }

  // Full wordmark
  return (
    <div
      className={`inline-flex flex-col items-center text-[color:var(--sn-gold)] ${className}`}
      style={{ lineHeight: 1 }}
      aria-label="Smile NOLA"
    >
      <span
        className="font-deco"
        style={{
          fontSize: size,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        Smile
      </span>
      <span
        className="font-deco"
        style={{
          fontSize: size * 0.62,
          letterSpacing: "0.5em",
          marginTop: size * 0.08,
          marginLeft: "0.5em",
          opacity: 0.9,
        }}
      >
        NOLA
      </span>
    </div>
  );
}
