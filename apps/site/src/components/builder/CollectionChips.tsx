import { COLLECTIONS, type CollectionId } from "@/lib/builder/catalog";

interface Props {
  selected: string[];
  onToggle: (id: string) => void;
}

const ORDERED_IDS: CollectionId[] = [...COLLECTIONS]
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map((c) => c.id);

export function CollectionChips({ selected, onToggle }: Props) {
  return (
    <section
      className="cc"
      role="region"
      aria-labelledby="cc-heading"
    >
      <h2 id="cc-heading" className="cc__label">
        01 · Choose your collections
      </h2>
      <p className="cc__hint">
        Tap any combination — each opens its own configuration below.
      </p>
      <div className="cc__row" role="group" aria-label="Collection toggles">
        {ORDERED_IDS.map((id) => {
          const c = COLLECTIONS.find((cc) => cc.id === id)!;
          const isOn = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`cc__chip${isOn ? " cc__chip--on" : ""}`}
              aria-pressed={isOn}
              onClick={() => onToggle(id)}
            >
              {c.displayName}
            </button>
          );
        })}
      </div>

      <style>{`
        .cc { display: flex; flex-direction: column; gap: 10px; }
        .cc__label {
          font-family: var(--font-body);
          font-size: 0.72rem;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cc__hint {
          color: var(--sn-muted-stone);
          font-size: 0.88rem;
          margin: 0 0 8px;
        }
        .cc__row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .cc__chip {
          font-family: var(--font-body);
          font-size: 0.78rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          background: transparent;
          color: var(--sn-ivory);
          border: 1px solid var(--sn-gold-40);
          border-radius: 999px;
          padding: 10px 18px;
          cursor: pointer;
          transition:
            background-color 200ms ease,
            border-color 200ms ease,
            color 200ms ease,
            box-shadow 200ms ease;
        }
        .cc__chip:hover {
          border-color: var(--sn-gold);
          color: var(--sn-gold);
        }
        .cc__chip--on {
          background: var(--sn-gold);
          color: var(--sn-black);
          border-color: var(--sn-gold);
          box-shadow: 0 0 18px var(--sn-amber-40);
        }
        .cc__chip--on:hover {
          color: var(--sn-black);
        }
      `}</style>
    </section>
  );
}
