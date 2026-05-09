"use client";

import { motion } from "framer-motion";
import { fadeUp } from "@/lib/motion";
import { LogoMark } from "@/components/brand/LogoMark";
import { GoldDivider } from "@/components/brand/GoldDivider";

interface Props {
  onBegin: () => void;
}

export function StepWelcome({ onBegin }: Props) {
  return (
    <button
      type="button"
      onClick={onBegin}
      aria-label="Begin inquiry"
      className="relative w-full min-h-[70vh] flex flex-col items-center justify-center gap-8 px-6 cursor-pointer outline-none focus-visible:outline-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <span className="ambient-glow" aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="text-[color:var(--sn-gold)]">
          <LogoMark size={56} />
        </span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center text-center gap-4 max-w-xl"
      >
        <p className="font-body text-[10px] tracking-[0.5em] uppercase text-[color:var(--sn-muted-stone)]">
          New Orleans Bridal & Wedding Expo
        </p>
        <h1
          className="font-deco text-[color:var(--sn-gold)] text-4xl sm:text-5xl md:text-6xl tracking-[0.06em] leading-[1.05]"
          style={{ textShadow: "0 0 30px var(--sn-amber-20)" }}
        >
          Let's design
          <br />
          your moment.
        </h1>
        <div className="w-32 mt-2">
          <GoldDivider />
        </div>
        <p className="font-body text-[color:var(--sn-champagne)] text-base sm:text-lg leading-relaxed opacity-90 max-w-md">
          Tell us about the celebration you're dreaming of. It takes about a
          minute, and a member of our team will follow up to design the
          experience with you.
        </p>
      </motion.div>

      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.6 }}
        className="mt-2"
      >
        <span className="btn-gold inline-flex items-center gap-3">
          Begin
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 7H13M13 7L7 1M13 7L7 13"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.7 }}
        transition={{ delay: 1.4, duration: 0.8 }}
        className="font-body text-xs tracking-[0.3em] uppercase text-[color:var(--sn-muted-stone)] mt-2"
      >
        Tap anywhere to begin
      </motion.p>
    </button>
  );
}
