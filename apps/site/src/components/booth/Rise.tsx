import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

/**
 * Entrance animation for the kiosk: fade + rise, driven by CSS (booth.css
 * `.sn-rise`) so no animation library is needed. `delay` is in seconds.
 */
interface RiseProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "p" | "h1" | "span";
  delay?: number;
  /** Animate to this opacity instead of 1 (hint text). */
  to?: number;
  children?: ReactNode;
}

export function Rise({ as = "div", delay = 0, to, className, style, children, ...rest }: RiseProps) {
  const merged = {
    ...style,
    "--sn-delay": `${delay}s`,
    ...(to !== undefined ? { "--sn-rise-to": String(to) } : {}),
  } as CSSProperties;
  return createElement(as, { ...rest, className: `sn-rise ${className ?? ""}`.trim(), style: merged }, children);
}

/** Stagger helper: delay for the nth field of a step. */
export const fieldDelay = (i: number) => 0.18 + i * 0.07;
