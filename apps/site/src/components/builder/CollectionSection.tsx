import { useState } from "react";
import type {
  AddonConfig,
  CollectionConfig,
  PackageConfig,
} from "@/lib/builder/catalog";
import type { SelectedAddon, SelectedPackage } from "@/lib/builder/compute";
import { PackageCard } from "./PackageCard";
import { AddonRow } from "./AddonRow";

interface Props {
  collection: CollectionConfig;
  selectedPackages: SelectedPackage[];
  selectedAddons: SelectedAddon[];
  onSelectPackage: (collectionId: string, packageId: string) => void;
  onTogglePackage: (collectionId: string, packageId: string) => void;
  onToggleAddon: (collectionId: string, addonId: string, defaultQty?: number) => void;
  onSetAddonQty: (collectionId: string, addonId: string, qty: number) => void;
}

/**
 * Per spec §4.2 step 5: Aurora's "full lighting menu" is collapsed under a
 * "More lighting & visual options" disclosure on first render. Only the
 * IDs listed here are visible by default; the rest reveal on disclosure
 * click OR if they're currently selected.
 */
const AURORA_DEFAULT_VISIBLE: ReadonlySet<string> = new Set([
  "led-wall-experience",
  "uplighting-apelabs",
  "dance-floor-lighting",
  "monogram-projection",
]);

export function CollectionSection({
  collection,
  selectedPackages,
  selectedAddons,
  onSelectPackage,
  onTogglePackage,
  onToggleAddon,
  onSetAddonQty,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const isMulti = collection.rules.allowMultiplePackages === true;
  const requiresOne = collection.rules.requireOneBasePackage === true;
  const headingId = `coll-${collection.id}-heading`;

  // Aurora: split addons into "always shown" and "behind disclosure".
  const hasDisclosure = collection.id === "aurora";
  const selectedAddonIds = new Set(selectedAddons.map((a) => a.addonId));

  const visibleAddons: AddonConfig[] = hasDisclosure
    ? collection.addons.filter(
        (a) => AURORA_DEFAULT_VISIBLE.has(a.id) || selectedAddonIds.has(a.id),
      )
    : collection.addons;

  const hiddenAddons: AddonConfig[] = hasDisclosure
    ? collection.addons.filter(
        (a) => !AURORA_DEFAULT_VISIBLE.has(a.id) && !selectedAddonIds.has(a.id),
      )
    : [];

  return (
    <section
      className="cs"
      role="region"
      aria-labelledby={headingId}
    >
      <header className="cs__header">
        <h2 id={headingId} className="cs__title">
          {collection.displayName}
        </h2>
        <p className="cs__desc">{collection.shortDescription}</p>
      </header>

      {collection.packages.length > 0 && (
        <div className="cs__packages">
          {collection.packages.map((pkg: PackageConfig) => {
            const isSelected = selectedPackages.some((sp) => sp.packageId === pkg.id);
            return (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                selected={isSelected}
                groupName={`pkg-${collection.id}`}
                inputType={isMulti ? "checkbox" : "radio"}
                requiredHint={requiresOne ? "Choose one to continue" : undefined}
                onSelect={() =>
                  isMulti
                    ? onTogglePackage(collection.id, pkg.id)
                    : onSelectPackage(collection.id, pkg.id)
                }
              />
            );
          })}
        </div>
      )}

      {visibleAddons.length > 0 && (
        <div className="cs__addons">
          <h3 className="cs__addons-label">Add-ons</h3>
          {visibleAddons.map((addon) => {
            const sel = selectedAddons.find((a) => a.addonId === addon.id);
            return (
              <AddonRow
                key={addon.id}
                collectionId={collection.id}
                addon={addon}
                checked={Boolean(sel)}
                qty={sel?.qty ?? 1}
                onToggle={() => onToggleAddon(collection.id, addon.id, 1)}
                onQtyChange={(q) => onSetAddonQty(collection.id, addon.id, q)}
              />
            );
          })}

          {hasDisclosure && hiddenAddons.length > 0 && (
            <div className="cs__disclosure">
              {!expanded ? (
                <button
                  type="button"
                  className="cs__disclosure-btn"
                  onClick={() => setExpanded(true)}
                  aria-expanded={false}
                >
                  More lighting & visual options ({hiddenAddons.length})
                </button>
              ) : (
                <>
                  {hiddenAddons.map((addon) => {
                    const sel = selectedAddons.find((a) => a.addonId === addon.id);
                    return (
                      <AddonRow
                        key={addon.id}
                        collectionId={collection.id}
                        addon={addon}
                        checked={Boolean(sel)}
                        qty={sel?.qty ?? 1}
                        onToggle={() => onToggleAddon(collection.id, addon.id, 1)}
                        onQtyChange={(q) =>
                          onSetAddonQty(collection.id, addon.id, q)
                        }
                      />
                    );
                  })}
                  <button
                    type="button"
                    className="cs__disclosure-btn"
                    onClick={() => setExpanded(false)}
                    aria-expanded={true}
                  >
                    Show fewer options
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        .cs {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .cs__header { display: flex; flex-direction: column; gap: 6px; }
        .cs__title {
          font-family: var(--font-body);
          font-size: 1.25rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cs__desc {
          color: var(--sn-muted-stone);
          font-size: 0.92rem;
          line-height: 1.6;
          margin: 0;
          max-width: 60ch;
        }
        .cs__packages {
          display: grid;
          gap: 12px;
        }
        .cs__addons {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 8px;
        }
        .cs__addons-label {
          font-family: var(--font-body);
          font-size: 0.72rem;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
          margin: 0 0 6px;
          font-weight: 500;
        }
        .cs__disclosure {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 4px;
        }
        .cs__disclosure-btn {
          align-self: flex-start;
          background: transparent;
          border: 1px solid var(--sn-gold-24);
          border-radius: 999px;
          padding: 8px 16px;
          color: var(--sn-muted-stone);
          font-family: var(--font-body);
          font-size: 0.78rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          cursor: pointer;
          transition:
            border-color 200ms ease,
            color 200ms ease;
        }
        .cs__disclosure-btn:hover {
          border-color: var(--sn-gold);
          color: var(--sn-gold);
        }
      `}</style>
    </section>
  );
}
