import { Rise } from "@/components/booth/Rise";
import { GoldDivider } from "@/components/booth/brand/GoldDivider";

interface Props {
  eyebrow?: string;
  headline: string;
  subhead?: string;
}

/**
 * Headline assembly used by every step. Broadway Art Deco display headline
 * with character-level reveal, Poppins eyebrow + subhead, gold divider.
 *
 * Per Brand Brief §5: Broadway is the chandelier. Poppins is the service
 * staff. Holimount is reserved for the closing thank-you only.
 */
export function StepHeader({ eyebrow, headline, subhead }: Props) {
  const chars = Array.from(headline);

  return (
    <div className="relative flex flex-col items-center text-center gap-2 mb-3 sm:mb-4 shrink-0">
      <span className="light-sweep" aria-hidden="true" />
      {eyebrow && (
        <Rise
          as="p"
          className="font-body text-[10px] tracking-[0.5em] uppercase text-[color:var(--sn-muted-stone)]"
        >
          {eyebrow}
        </Rise>
      )}
      <h1 aria-label={headline} className="sn-headline">
        {chars.map((ch, i) => (
          <span
            key={`${ch}-${i}`}
            aria-hidden="true"
            className="sn-char"
            style={{
              whiteSpace: ch === " " ? "pre" : "normal",
              ["--sn-delay" as string]: `${0.05 + i * 0.025}s`,
            }}
          >
            {ch}
          </span>
        ))}
      </h1>
      {subhead && (
        <Rise
          as="p"
          delay={0.55}
          className="font-body max-w-md text-[color:var(--sn-champagne)] text-xs sm:text-sm tracking-wide opacity-85"
        >
          {subhead}
        </Rise>
      )}
      <Rise delay={0.7} className="w-20">
        <GoldDivider />
      </Rise>
    </div>
  );
}
