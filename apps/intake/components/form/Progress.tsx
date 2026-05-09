"use client";

import { motion } from "framer-motion";
import { DecoCorner } from "@/components/brand/DecoCorner";

interface Props {
  /** 0-indexed current step among non-welcome/non-thankyou steps */
  currentStep: number;
  totalSteps: number;
  visible: boolean;
}

/**
 * Thin gold horizontal progress bar with Art Deco corner brackets.
 * Hidden on welcome and thank-you screens.
 */
export function Progress({ currentStep, totalSteps, visible }: Props) {
  const pct = Math.max(
    0,
    Math.min(1, totalSteps > 0 ? (currentStep + 1) / totalSteps : 0),
  );

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? 0 : -6,
      }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md mx-auto select-none"
      aria-hidden={!visible}
    >
      <div className="flex items-center gap-3 text-[color:var(--sn-gold)]">
        <DecoCorner position="tl" size={18} />
        <div className="flex-1 h-px bg-[color:var(--sn-gold-24)] relative overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-[color:var(--sn-gold)]"
            initial={false}
            animate={{ width: `${pct * 100}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{
              boxShadow:
                "0 0 8px var(--sn-amber-40), 0 0 18px var(--sn-gold-24)",
            }}
          />
        </div>
        <DecoCorner position="tr" size={18} />
      </div>
      <div className="mt-2 text-center font-body text-[10px] tracking-[0.4em] uppercase text-[color:var(--sn-muted-stone)]">
        Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}
      </div>
    </motion.div>
  );
}
