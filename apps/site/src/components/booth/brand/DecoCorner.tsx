type Position = "tl" | "tr" | "bl" | "br";

interface Props {
  position: Position;
  size?: number;
  className?: string;
}

/**
 * Thin Art Deco corner ornament — used at the corners of the form card
 * and decorative containers. Pure SVG so it's crisp at any DPI.
 */
export function DecoCorner({ position, size = 28, className = "" }: Props) {
  const transform = {
    tl: "rotate(0deg)",
    tr: "rotate(90deg)",
    br: "rotate(180deg)",
    bl: "rotate(270deg)",
  }[position];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform }}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M1 14V1H14"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
      />
      <path
        d="M5 9V5H9"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        opacity="0.55"
      />
    </svg>
  );
}
