import { COLLECTIONS, getAddon, getPackage } from "@/lib/builder/catalog";
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

interface DisplayLine {
  key: string;
  collectionName: string;
  label: string;
  qtySuffix: string;
  priceLabel: string;
  isSoft: boolean;
}

function buildLines(state: BuilderStateShape): DisplayLine[] {
  const lines: DisplayLine[] = [];
  for (const collection of COLLECTIONS) {
    if (!state.collections.includes(collection.id)) continue;

    for (const sp of state.packages) {
      if (sp.collectionId !== collection.id) continue;
      const pkg = getPackage(sp.collectionId, sp.packageId);
      if (!pkg) continue;
      lines.push({
        key: `pkg-${sp.collectionId}-${sp.packageId}`,
        collectionName: collection.displayName,
        label: pkg.name,
        qtySuffix: "",
        priceLabel: formatDollars(pkg.priceCents),
        isSoft: false,
      });
    }

    for (const sa of state.addons) {
      if (sa.collectionId !== collection.id) continue;
      const addon = getAddon(sa.collectionId, sa.addonId);
      if (!addon) continue;
      let priceLabel: string;
      let isSoft = false;
      if (addon.priceType === "custom") {
        priceLabel = "custom quoted";
        isSoft = true;
      } else if (addon.priceType === "starting") {
        priceLabel =
          addon.priceCents !== null
            ? `starts at ${formatDollars(addon.priceCents)}`
            : "starts at custom";
        isSoft = true;
      } else {
        priceLabel = formatDollars((addon.priceCents ?? 0) * sa.qty);
      }
      const qtySuffix =
        addon.qty === true && sa.qty > 1 ? ` × ${sa.qty}` : "";
      lines.push({
        key: `addon-${sa.collectionId}-${sa.addonId}`,
        collectionName: collection.displayName,
        label: addon.name,
        qtySuffix,
        priceLabel,
        isSoft,
      });
    }
  }
  return lines;
}

export function InvestmentRail({ state, preview }: Props) {
  const lines = buildLines(state);
  const isEmpty = lines.length === 0;
  const subtotalCents = preview.ok ? preview.fixedSubtotalCents : 0;
  const warnings = preview.ok ? preview.warnings : [];

  return (
    <div className="ir">
      <h2 className="ir__eyebrow">Your selections</h2>

      {isEmpty ? (
        <p className="ir__empty">
          Pick a collection to begin shaping your event.
        </p>
      ) : (
        <ul className="ir__list">
          {lines.map((line) => (
            <li key={line.key} className="ir__row">
              <span className="ir__name">
                {line.label}
                {line.qtySuffix && (
                  <span className="ir__qty">{line.qtySuffix}</span>
                )}
              </span>
              <span className={`ir__price${line.isSoft ? " ir__price--soft" : ""}`}>
                {line.priceLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="ir__divider" aria-hidden="true" />

      <div className="ir__subtotal">
        <span className="ir__subtotal-label">Starting</span>
        <span className="ir__subtotal-value">
          {formatDollars(subtotalCents)}
        </span>
      </div>

      {warnings.length > 0 && (
        <ul className="ir__warnings" aria-live="polite">
          {warnings.map((w) => (
            <li
              key={w.code}
              className={`ir__warning ir__warning--${
                w.code === "aurora-minimum-not-met" ? "coral" : "gold"
              }`}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <button type="submit" className="btn-gold ir__send">
        Send Selections
      </button>

      <style>{`
        .ir {
          background: rgba(20, 14, 8, 0.85);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          color: var(--sn-ivory);
        }
        .ir__eyebrow {
          font-family: var(--font-body);
          font-size: 0.7rem;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .ir__empty {
          color: var(--sn-muted-stone);
          font-size: 0.85rem;
          font-style: italic;
          margin: 0;
        }
        .ir__list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ir__row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 0.85rem;
          line-height: 1.4;
        }
        .ir__name { color: var(--sn-ivory); flex: 1; min-width: 0; }
        .ir__qty { color: var(--sn-muted-stone); margin-left: 4px; }
        .ir__price {
          color: var(--sn-gold);
          font-weight: 500;
          white-space: nowrap;
        }
        .ir__price--soft {
          color: var(--sn-muted-stone);
          font-style: italic;
          font-weight: 400;
        }
        .ir__divider {
          height: 1px;
          background: var(--sn-gold-24);
        }
        .ir__subtotal {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .ir__subtotal-label {
          font-size: 0.7rem;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
        }
        .ir__subtotal-value {
          font-family: var(--font-body);
          font-size: 1.4rem;
          font-weight: 600;
          color: var(--sn-gold);
          letter-spacing: 0.02em;
        }
        .ir__warnings {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ir__warning {
          padding: 10px 12px;
          font-size: 0.78rem;
          line-height: 1.5;
          color: var(--sn-champagne);
          border-radius: 2px;
          background: rgba(0, 0, 0, 0.3);
        }
        .ir__warning--coral {
          border-left: 2px solid #d97a6e;
        }
        .ir__warning--gold {
          border-left: 2px solid var(--sn-gold-40);
        }
        .ir__send {
          margin-top: 4px;
          width: 100%;
          padding: 14px 20px;
          font-size: 0.72rem;
        }
      `}</style>
    </div>
  );
}
