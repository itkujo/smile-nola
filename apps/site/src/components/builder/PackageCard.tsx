import type { PackageConfig } from "@/lib/builder/catalog";

interface Props {
  pkg: PackageConfig;
  selected: boolean;
  groupName: string;
  inputType: "radio" | "checkbox";
  requiredHint?: string;
  onSelect: () => void;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

/**
 * Render the price label on a package card. "starting" packages (e.g.
 * Resonance Concert Package) read as "Starts at $X" because the real
 * price is a configuration conversation; the gold number alone would
 * misleadingly imply finality.
 */
function packagePriceLabel(pkg: PackageConfig): string {
  const cents = formatDollars(pkg.priceCents);
  return pkg.priceType === "starting" ? `Starts at ${cents}` : cents;
}

export function PackageCard({
  pkg,
  selected,
  groupName,
  inputType,
  requiredHint,
  onSelect,
}: Props) {
  const inputId = `pkg-${groupName}-${pkg.id}`;
  return (
    <label
      htmlFor={inputId}
      className={`pc${selected ? " pc--on" : ""}`}
    >
      <input
        id={inputId}
        type={inputType}
        name={groupName}
        checked={selected}
        onChange={onSelect}
        className="pc__input"
      />
      <div className="pc__body">
        <div className="pc__row">
          <span className="pc__name">{pkg.name}</span>
          <span className="pc__price">{packagePriceLabel(pkg)}</span>
        </div>
        {pkg.duration && <span className="pc__duration">{pkg.duration}</span>}
        {pkg.description && <p className="pc__desc">{pkg.description}</p>}
        {requiredHint && !selected && (
          <span className="pc__hint">{requiredHint}</span>
        )}
      </div>

      <style>{`
        .pc {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 16px 18px;
          background: rgba(0, 0, 0, 0.22);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
          cursor: pointer;
          transition:
            border-color 200ms ease,
            background-color 200ms ease,
            box-shadow 200ms ease;
        }
        .pc:hover {
          border-color: var(--sn-gold-40);
        }
        .pc--on {
          border-color: var(--sn-gold);
          background: rgba(212, 175, 55, 0.05);
          box-shadow: 0 0 20px var(--sn-amber-20);
        }
        .pc__input {
          margin-top: 4px;
          accent-color: var(--sn-gold);
          flex-shrink: 0;
        }
        .pc__body {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }
        .pc__row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }
        .pc__name {
          font-family: var(--font-body);
          font-size: 1rem;
          font-weight: 500;
          color: var(--sn-ivory);
        }
        .pc__price {
          font-family: var(--font-body);
          font-size: 1rem;
          font-weight: 600;
          color: var(--sn-gold);
          letter-spacing: 0.02em;
        }
        .pc__duration {
          font-size: 0.78rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
        }
        .pc__desc {
          color: var(--sn-muted-stone);
          font-size: 0.88rem;
          line-height: 1.6;
          margin: 4px 0 0;
        }
        .pc__hint {
          color: var(--sn-amber);
          font-size: 0.74rem;
          letter-spacing: 0.14em;
          margin-top: 4px;
        }
      `}</style>
    </label>
  );
}
