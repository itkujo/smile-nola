import { useState } from "react";
import { InvestmentRail } from "./InvestmentRail";
import type { ComputeResult } from "@/lib/builder/compute";
import type { BuilderStateShape } from "./useBuilderState";

interface Props {
  state: BuilderStateShape;
  preview: ComputeResult;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export function MobileRailBar({ state, preview }: Props) {
  const [open, setOpen] = useState(false);
  const subtotalCents = preview.ok ? preview.fixedSubtotalCents : 0;

  return (
    <div className="mrb">
      {open && (
        <div className="mrb__sheet" role="dialog" aria-label="Selection summary">
          <button
            type="button"
            className="mrb__close"
            onClick={() => setOpen(false)}
            aria-label="Close summary"
          >
            ×
          </button>
          <div className="mrb__sheet-inner">
            <InvestmentRail state={state} preview={preview} />
          </div>
        </div>
      )}
      <div className="mrb__bar">
        <button
          type="button"
          className="mrb__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle selection summary"
        >
          <span className="mrb__starting">Starting</span>
          <strong className="mrb__total">{formatDollars(subtotalCents)}</strong>
          <span className="mrb__chev" aria-hidden="true">
            {open ? "▾" : "▴"}
          </span>
        </button>
        <button type="submit" className="btn-gold mrb__send">
          Send
        </button>
      </div>

      <style>{`
        .mrb {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          pointer-events: none;
        }
        @media (min-width: 1024px) {
          .mrb { display: none; }
        }
        .mrb__bar {
          pointer-events: auto;
          display: flex;
          align-items: stretch;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(5, 5, 5, 0.94);
          border-top: 1px solid var(--sn-gold-24);
          backdrop-filter: blur(8px);
        }
        .mrb__toggle {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          background: transparent;
          border: 1px solid var(--sn-gold-24);
          border-radius: 999px;
          padding: 10px 16px;
          color: var(--sn-ivory);
          cursor: pointer;
          font-family: var(--font-body);
        }
        .mrb__starting {
          font-size: 0.7rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
        }
        .mrb__total {
          color: var(--sn-gold);
          font-size: 1.05rem;
          font-weight: 600;
        }
        .mrb__chev {
          margin-left: auto;
          color: var(--sn-gold);
        }
        .mrb__send {
          padding: 12px 22px;
          font-size: 0.68rem;
        }
        .mrb__sheet {
          pointer-events: auto;
          position: absolute;
          left: 0;
          right: 0;
          bottom: 100%;
          max-height: 70vh;
          overflow-y: auto;
          background: var(--sn-black);
          border-top: 1px solid var(--sn-gold-24);
          padding: 16px 16px 12px;
          transition: transform 200ms ease;
        }
        .mrb__sheet-inner {
          padding-right: 4px;
        }
        .mrb__close {
          position: absolute;
          top: 8px;
          right: 12px;
          background: transparent;
          border: 0;
          color: var(--sn-gold);
          font-size: 1.5rem;
          line-height: 1;
          cursor: pointer;
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
