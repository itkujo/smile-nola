"use client";

import { motion } from "framer-motion";
import { headlineChar, headlineReveal, fadeUp } from "@/lib/motion";
import { GoldDivider } from "@/components/brand/GoldDivider";

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
  // Split the headline into characters for the reveal animation, but keep
  // spaces intact and avoid splitting non-Latin characters in unexpected ways.
  const chars = Array.from(headline);

  return (
    <div className="relative flex flex-col items-center text-center gap-2 mb-3 sm:mb-4 shrink-0">
      <span className="light-sweep" aria-hidden="true" />
      {eyebrow && (
        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="font-body text-[10px] tracking-[0.5em] uppercase text-[color:var(--sn-muted-stone)]"
        >
          {eyebrow}
        </motion.p>
      )}
      <motion.h1
        aria-label={headline}
        variants={headlineReveal}
        initial="hidden"
        animate="visible"
        className="sn-headline"
      >
        {chars.map((ch, i) => (
          <motion.span
            key={`${ch}-${i}`}
            variants={headlineChar}
            aria-hidden="true"
            className="inline-block"
            style={{ whiteSpace: ch === " " ? "pre" : "normal" }}
          >
            {ch}
          </motion.span>
        ))}
      </motion.h1>
      {subhead && (
        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.55 }}
          className="font-body max-w-md text-[color:var(--sn-champagne)] text-xs sm:text-sm tracking-wide opacity-85"
        >
          {subhead}
        </motion.p>
      )}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.7 }}
        className="w-20"
      >
        <GoldDivider />
      </motion.div>
    </div>
  );
}
