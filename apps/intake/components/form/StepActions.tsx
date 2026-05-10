"use client";

import { motion } from "framer-motion";
import { fadeUp } from "@/lib/motion";

interface Props {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
}

export function StepActions({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  loading,
}: Props) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.4 }}
      className="mt-4 sm:mt-5 pt-3 flex flex-col-reverse sm:flex-row items-center justify-between gap-3 shrink-0"
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost"
          disabled={loading}
        >
          Back
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          className="btn-gold inline-flex items-center gap-3"
          disabled={nextDisabled || loading}
          aria-busy={loading}
        >
          {loading && (
            <span
              aria-hidden="true"
              className="inline-block w-3 h-3 rounded-full border-2 border-[color:var(--sn-black)] border-t-transparent animate-spin"
            />
          )}
          {nextLabel}
        </button>
      )}
    </motion.div>
  );
}
