import { useEffect, useState } from "react";
import { Rise } from "@/components/booth/Rise";
import { LogoMark } from "@/components/booth/brand/LogoMark";
import { GoldDivider } from "@/components/booth/brand/GoldDivider";

interface Props {
  partner1: string;
  partner2: string | null | undefined;
  onReset: () => void;
}

const AUTO_RESET_MS = 9000;
const HINT_DELAY_MS = 4500;

export function StepThankYou({ partner1, partner2, onReset }: Props) {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const hintTimer = setTimeout(() => setShowHint(true), HINT_DELAY_MS);
    const resetTimer = setTimeout(onReset, AUTO_RESET_MS);
    return () => {
      clearTimeout(hintTimer);
      clearTimeout(resetTimer);
    };
  }, [onReset]);

  // Holimount is reserved for THIS moment only.
  const namesLine =
    partner2 && partner2.trim()
      ? `Thank you, ${partner1.trim()} & ${partner2.trim()}.`
      : `Thank you, ${partner1.trim()}.`;

  // Word-level reveal for the script (per-character on Holimount can ligature-break).
  const words = namesLine.split(" ");

  return (
    <button
      type="button"
      onClick={onReset}
      aria-label="Tap to begin again"
      className="relative w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6 outline-none focus-visible:outline-none cursor-pointer"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <span className="ambient-glow" aria-hidden="true" />
      <span className="light-sweep" aria-hidden="true" />

      <Rise>
        <LogoMark submarkOnly size={88} glow color="var(--sn-gold)" />
      </Rise>

      <h1
        aria-label={namesLine}
        className="font-signature text-[color:var(--sn-gold)] text-5xl sm:text-6xl md:text-7xl text-center leading-[1.05] max-w-3xl"
        style={{ textShadow: "0 0 30px var(--sn-amber-40)" }}
      >
        {words.map((w, i) => (
          <span
            key={`${w}-${i}`}
            className="sn-char"
            aria-hidden="true"
            style={{ ["--sn-delay" as string]: `${0.4 + i * 0.07}s` }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </h1>

      <Rise delay={1.3} className="w-40 origin-center">
        <GoldDivider />
      </Rise>

      <Rise
        as="p"
        delay={1.5}
        to={0.95}
        className="font-body text-[color:var(--sn-champagne)] text-center text-base sm:text-lg max-w-xl leading-relaxed"
      >
        A member of the Smile NOLA team will reach out within 24 hours to design your moment.
      </Rise>

      <p
        className="absolute bottom-8 font-body text-xs tracking-[0.4em] uppercase text-[color:var(--sn-muted-stone)]"
        style={{ opacity: showHint ? 0.8 : 0, transition: "opacity 600ms ease" }}
      >
        Tap to begin again
      </p>
    </button>
  );
}
