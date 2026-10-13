interface Props {
  className?: string;
  withDiamond?: boolean;
}

/**
 * Thin gold horizontal rule. Optionally with a centered diamond ornament
 * (Art Deco signature). Uses brand gold token.
 */
export function GoldDivider({ className = "", withDiamond = true }: Props) {
  return (
    <div
      className={`flex items-center gap-3 text-[color:var(--sn-gold)] ${className}`}
      aria-hidden="true"
    >
      <span className="flex-1 h-px bg-[color:var(--sn-gold-40)]" />
      {withDiamond && (
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          className="shrink-0"
          fill="currentColor"
        >
          <path d="M4 0L8 4L4 8L0 4Z" />
        </svg>
      )}
      <span className="flex-1 h-px bg-[color:var(--sn-gold-40)]" />
    </div>
  );
}
