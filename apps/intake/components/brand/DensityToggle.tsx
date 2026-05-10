"use client";

import { useEffect, useState } from "react";

export type Density = "standard" | "large";

const STORAGE_KEY = "sn-density";

/**
 * Pill selector that toggles font/spacing density between "Standard" and "Large".
 * Affects layout via a `data-density` attribute on the document element which
 * drives a small set of CSS custom properties (see globals.css).
 *
 * Persisted in localStorage so the booth attendant's choice survives reloads.
 */
export function DensityToggle({ className = "" }: { className?: string }) {
  const [density, setDensity] = useState<Density>("standard");
  const [hydrated, setHydrated] = useState(false);

  // Read persisted choice on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "large" || saved === "standard") {
        setDensity(saved);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Apply to documentElement whenever density changes
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.setAttribute("data-density", density);
    try {
      localStorage.setItem(STORAGE_KEY, density);
    } catch {
      /* ignore */
    }
  }, [density, hydrated]);

  const set = (next: Density) => () => setDensity(next);

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border border-[color:var(--sn-gold-24)] bg-[color:var(--sn-soft-black)] p-1 backdrop-blur-sm ${className}`}
      role="radiogroup"
      aria-label="Text size"
    >
      <PillButton
        selected={density === "standard"}
        onClick={set("standard")}
        label="Standard text size"
      >
        <span className="text-[10px] tracking-[0.18em]">A</span>
      </PillButton>
      <PillButton
        selected={density === "large"}
        onClick={set("large")}
        label="Large text size"
      >
        <span className="text-[14px] tracking-[0.18em] font-semibold">A</span>
      </PillButton>
    </div>
  );
}

interface PillProps {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}

function PillButton({ selected, onClick, label, children }: PillProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center min-w-9 h-9 rounded-full font-body uppercase transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sn-gold)]"
      style={{
        backgroundColor: selected ? "var(--sn-gold)" : "transparent",
        color: selected ? "var(--sn-black)" : "var(--sn-champagne)",
        boxShadow: selected ? "0 0 14px var(--sn-amber-40)" : "none",
        padding: "0 0.75rem",
      }}
    >
      {children}
    </button>
  );
}
