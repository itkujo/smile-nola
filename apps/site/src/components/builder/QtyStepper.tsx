interface Props {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}

export function QtyStepper({
  value,
  min = 1,
  max,
  onChange,
  ariaLabel,
}: Props) {
  const canDec = value > min;
  const canInc = max === undefined || value < max;

  return (
    <div
      className="qs"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="qs__btn"
        aria-label="Decrease quantity"
        disabled={!canDec}
        onClick={() => canDec && onChange(value - 1)}
      >
        −
      </button>
      <span className="qs__value" aria-live="polite">{value}</span>
      <button
        type="button"
        className="qs__btn"
        aria-label="Increase quantity"
        disabled={!canInc}
        onClick={() => canInc && onChange(value + 1)}
      >
        +
      </button>

      <style>{`
        .qs {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid var(--sn-gold-24);
          border-radius: 999px;
          padding: 2px;
          background: rgba(0, 0, 0, 0.3);
        }
        .qs__btn {
          width: 28px;
          height: 28px;
          background: transparent;
          border: 0;
          color: var(--sn-gold);
          font-family: var(--font-body);
          font-size: 1rem;
          line-height: 1;
          cursor: pointer;
          border-radius: 999px;
          transition: background-color 200ms ease, color 200ms ease;
        }
        .qs__btn:hover:not(:disabled) {
          background: var(--sn-gold-12);
        }
        .qs__btn:disabled {
          color: var(--sn-muted-stone);
          opacity: 0.4;
          cursor: not-allowed;
        }
        .qs__value {
          min-width: 22px;
          text-align: center;
          color: var(--sn-ivory);
          font-family: var(--font-body);
          font-size: 0.9rem;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
