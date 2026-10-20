import { Rise } from "@/components/booth/Rise";
import { LogoMark } from "@/components/booth/brand/LogoMark";
import { GoldDivider } from "@/components/booth/brand/GoldDivider";

interface Props {
  onBegin: () => void;
}

export function StepWelcome({ onBegin }: Props) {
  return (
    <button
      type="button"
      onClick={onBegin}
      aria-label="Begin inquiry"
      className="relative w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6 cursor-pointer outline-none focus-visible:outline-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <span className="ambient-glow" aria-hidden="true" />
      <Rise className="w-full max-w-[min(560px,80vw)]" style={{ height: "clamp(80px, 18vh, 160px)" }}>
        <LogoMark size={120} glow color="var(--sn-gold)" className="w-full h-full" />
      </Rise>

      <Rise delay={0.2} className="flex flex-col items-center text-center gap-4 max-w-xl">
        <p className="font-body text-[10px] tracking-[0.5em] uppercase text-[color:var(--sn-muted-stone)]">
          New Orleans Bridal & Wedding Expo
        </p>
        <h1
          className="font-deco text-[color:var(--sn-gold)] text-3xl sm:text-4xl md:text-5xl tracking-[0.06em] leading-[1.05] lowercase"
          style={{ textShadow: "0 0 30px var(--sn-amber-20)" }}
        >
          let&apos;s design your moment.
        </h1>
        <div className="w-32 mt-2">
          <GoldDivider />
        </div>
        <p className="font-body text-[color:var(--sn-champagne)] text-base sm:text-lg leading-relaxed opacity-90 max-w-md">
          Tell us about the celebration you're dreaming of. It takes about a minute, and a member of our team will
          follow up to design the experience with you.
        </p>
      </Rise>

      <Rise delay={0.6} className="mt-2">
        <span className="btn-gold inline-flex items-center gap-3">
          Begin
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      </Rise>

      <Rise
        as="p"
        delay={1.4}
        to={0.7}
        className="font-body text-xs tracking-[0.3em] uppercase text-[color:var(--sn-muted-stone)] mt-2"
      >
        Tap anywhere to begin
      </Rise>
    </button>
  );
}
