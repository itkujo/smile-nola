"use client";

import type { Variants } from "framer-motion";

/**
 * Reusable motion presets. All transitions favor compositor-only properties
 * (transform/opacity) for buttery 60fps on iPad Safari.
 *
 * Aesthetic: cinematic, intentional, never gimmicky. Brand brief §14:
 * "Keep animation subtle: fade, glow, gentle parallax, or light sweep."
 */

const easeOutCinematic: [number, number, number, number] = [0.16, 1, 0.3, 1];
const easeInCinematic: [number, number, number, number] = [0.7, 0, 0.84, 0];

export const stepVariants: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? 28 : -28,
    filter: "blur(6px)",
  }),
  center: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.55,
      ease: easeOutCinematic,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? -28 : 28,
    filter: "blur(6px)",
    transition: {
      duration: 0.32,
      ease: easeInCinematic,
    },
  }),
};

export const fieldStaggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.18,
    },
  },
};

export const fieldStaggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOutCinematic },
  },
};

export const headlineReveal: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.05,
    },
  },
};

export const headlineChar: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: easeOutCinematic },
  },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOutCinematic },
  },
};

export const cinematicEase = easeOutCinematic;
