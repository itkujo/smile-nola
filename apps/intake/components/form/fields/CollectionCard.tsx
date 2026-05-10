"use client";

import { motion } from "framer-motion";
import { COLLECTIONS, type CollectionId } from "@/lib/schema";
import { DecoCorner } from "@/components/brand/DecoCorner";

interface Props {
  values: CollectionId[];
  onToggle: (id: CollectionId) => void;
  error?: string;
}

/**
 * Multi-select card group for the five Smile NOLA collections.
 * Per Brand Brief §9: "one clear service visual per thumbnail."
 * No images here (booth use), just typography + brand corner brackets.
 */
export function CollectionCardGrid({ values, onToggle, error }: Props) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[10px] font-body font-medium uppercase tracking-[0.36em] text-[color:var(--sn-muted-stone)]">
        Which experiences are calling your name?
      </legend>
      <div
        role="group"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {COLLECTIONS.map((c) => {
          const selected = values.includes(c.id);
          return (
            <motion.button
              type="button"
              key={c.id}
              aria-pressed={selected}
              onClick={() => onToggle(c.id)}
              whileTap={{ scale: 0.98 }}
              className="relative text-left rounded-md p-4 transition-colors duration-300 outline-none"
              style={{
                backgroundColor: selected
                  ? "rgba(212, 175, 55, 0.08)"
                  : "var(--sn-soft-black)",
                border: `1px solid ${
                  selected ? "var(--sn-gold)" : "var(--sn-gold-24)"
                }`,
                boxShadow: selected
                  ? "0 0 18px var(--sn-amber-20), inset 0 0 24px rgba(212,175,55,0.06)"
                  : "none",
              }}
            >
              <span className="absolute -top-px -left-px text-[color:var(--sn-gold)]">
                <DecoCorner position="tl" size={12} />
              </span>
              <span className="absolute -bottom-px -right-px text-[color:var(--sn-gold)]">
                <DecoCorner position="br" size={12} />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="font-deco text-[color:var(--sn-gold)] text-base sm:text-lg tracking-[0.06em] lowercase leading-tight">
                    {c.label}
                  </span>
                  <span className="font-body text-[12px] tracking-wide text-[color:var(--sn-champagne)] opacity-80">
                    {c.tagline}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 mt-1 w-5 h-5 rounded-full border flex items-center justify-center transition-colors"
                  style={{
                    borderColor: selected
                      ? "var(--sn-gold)"
                      : "var(--sn-gold-40)",
                    backgroundColor: selected ? "var(--sn-gold)" : "transparent",
                  }}
                >
                  {selected && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                    >
                      <path
                        d="M1 5L4 8L9 1.5"
                        stroke="var(--sn-black)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
      {error && (
        <p
          role="alert"
          className="text-xs font-body text-[color:var(--sn-amber)] tracking-wide"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
}
