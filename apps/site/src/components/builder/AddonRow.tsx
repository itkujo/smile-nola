import type { AddonConfig } from "@/lib/builder/catalog";
import { QtyStepper } from "./QtyStepper";

interface Props {
  collectionId: string;
  addon: AddonConfig;
  checked: boolean;
  qty: number;
  onToggle: () => void;
  onQtyChange: (next: number) => void;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

function renderPrice(addon: AddonConfig): string {
  if (addon.priceType === "custom") return "custom quoted";
  if (addon.priceType === "starting") {
    return addon.priceCents !== null
      ? `starts at ${formatDollars(addon.priceCents)}`
      : "starts at custom";
  }
  return addon.priceCents !== null ? formatDollars(addon.priceCents) : "—";
}

export function AddonRow({
  collectionId,
  addon,
  checked,
  qty,
  onToggle,
  onQtyChange,
}: Props) {
  const id = `addon-${collectionId}-${addon.id}`;
  const showStepper = checked && addon.qty === true;
  const isCustom = addon.priceType !== "fixed";

  return (
    <div className={`ar${checked ? " ar--on" : ""}`}>
      <label htmlFor={id} className="ar__label">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="ar__check"
        />
        <span className="ar__body">
          <span className="ar__name">{addon.name}</span>
          {addon.note && <span className="ar__note">{addon.note}</span>}
        </span>
        <span className={`ar__price${isCustom ? " ar__price--soft" : ""}`}>
          {renderPrice(addon)}
        </span>
      </label>
      {showStepper && (
        <div className="ar__qty">
          <QtyStepper
            value={qty}
            min={1}
            max={addon.qtyMax}
            onChange={onQtyChange}
            ariaLabel={`${addon.name} quantity`}
          />
        </div>
      )}

      <style>{`
        .ar {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 2px;
          transition: background-color 200ms ease;
        }
        .ar:hover { background: rgba(212, 175, 55, 0.04); }
        .ar--on { background: rgba(212, 175, 55, 0.06); }
        .ar__label {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 12px;
          align-items: start;
          cursor: pointer;
        }
        .ar__check {
          margin-top: 4px;
          accent-color: var(--sn-gold);
          flex-shrink: 0;
        }
        .ar__body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .ar__name {
          font-family: var(--font-body);
          font-size: 0.95rem;
          color: var(--sn-ivory);
        }
        .ar__note {
          font-size: 0.78rem;
          color: var(--sn-muted-stone);
          font-style: italic;
        }
        .ar__price {
          font-family: var(--font-body);
          font-size: 0.95rem;
          color: var(--sn-gold);
          font-weight: 500;
          white-space: nowrap;
        }
        .ar__price--soft {
          color: var(--sn-muted-stone);
          font-style: italic;
          font-weight: 400;
        }
        .ar__qty {
          padding-left: 28px;
        }
      `}</style>
    </div>
  );
}
