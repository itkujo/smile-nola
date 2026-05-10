"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/LogoMark";
import { GoldDivider } from "@/components/brand/GoldDivider";
import { headlineChar, headlineReveal } from "@/lib/motion";

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

  // Construct the script line — Holimount is reserved for THIS moment only.
  const namesLine =
    partner2 && partner2.trim()
      ? `Thank you, ${partner1.trim()} & ${partner2.trim()}.`
      : `Thank you, ${partner1.trim()}.`;

  // Use word-level reveal for the script (per-character on Holimount can ligature-break).
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

      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <LogoMark submarkOnly size={88} glow color="var(--sn-gold)" />
      </motion.div>

      <motion.h1
        aria-label={namesLine}
        variants={headlineReveal}
        initial="hidden"
        animate="visible"
        transition={{ delayChildren: 0.4, staggerChildren: 0.07 }}
        className="font-signature text-[color:var(--sn-gold)] text-5xl sm:text-6xl md:text-7xl text-center leading-[1.05] max-w-3xl"
        style={{ textShadow: "0 0 30px var(--sn-amber-40)" }}
      >
        {words.map((w, i) => (
          <motion.span
            key={`${w}-${i}`}
            variants={headlineChar}
            className="inline-block"
            aria-hidden="true"
          >
            {w}
            {i < words.length - 1 ? "\u00A0" : ""}
          </motion.span>
        ))}
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, scaleX: 0 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ delay: 1.3, duration: 0.8 }}
        className="w-40 origin-center"
      >
        <GoldDivider />
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 0.95, y: 0 }}
        transition={{ delay: 1.5, duration: 0.7 }}
        className="font-body text-[color:var(--sn-champagne)] text-center text-base sm:text-lg max-w-xl leading-relaxed"
      >
        A member of the Smile NOLA team will reach out within 24 hours
        to design your moment.
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: showHint ? 0.8 : 0 }}
        transition={{ duration: 0.6 }}
        className="absolute bottom-8 font-body text-xs tracking-[0.4em] uppercase text-[color:var(--sn-muted-stone)]"
      >
        Tap to begin again
      </motion.p>
    </button>
  );
}
