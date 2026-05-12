import type { EventDetailsValue } from "./useBuilderState";

interface Props {
  value: EventDetailsValue;
  onChange: (patch: Partial<EventDetailsValue>) => void;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "wedding",     label: "Wedding" },
  { value: "corporate",   label: "Corporate" },
  { value: "private",     label: "Private celebration" },
  { value: "other",       label: "Other" },
];

export function EventDetails({ value, onChange }: Props) {
  return (
    <section
      className="ed"
      role="region"
      aria-labelledby="ed-heading"
    >
      <h2 id="ed-heading" className="ed__label">
        Event details
      </h2>

      <div className="ed__grid">
        <label className="sn-field-wrap">
          <span className="sn-field-label">Event date</span>
          <input
            type="date"
            value={value.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <fieldset className="ed__types">
          <legend className="sn-field-label">Event type</legend>
          <div className="ed__chips">
            {TYPE_OPTIONS.map((opt) => {
              const on = value.type === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`ed__chip${on ? " ed__chip--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => onChange({ type: on ? "" : opt.value })}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="sn-field-wrap ed__span2">
          <span className="sn-field-label">Venue or location</span>
          <input
            type="text"
            value={value.venue}
            onChange={(e) => onChange({ venue: e.target.value })}
            autoComplete="off"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Estimated guest count</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={value.guestCount ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              onChange({ guestCount: raw === "" ? null : Number.parseInt(raw, 10) });
            }}
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap ed__span2">
          <span className="sn-field-label">
            Tell us about the moment you want to create
          </span>
          <textarea
            rows={4}
            value={value.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Setting, mood, the feeling you're chasing…"
          />
        </label>
      </div>

      <style>{`
        .ed {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .ed__label {
          font-family: var(--font-body);
          font-size: 1.05rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .ed__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 22px 18px;
        }
        .ed__span2 { grid-column: 1 / -1; }
        @media (max-width: 640px) {
          .ed__grid { grid-template-columns: 1fr; }
          .ed__span2 { grid-column: auto; }
        }
        .ed__types {
          border: 0;
          padding: 0;
          margin: 0;
          grid-column: 1 / -1;
        }
        .ed__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 6px;
        }
        .ed__chip {
          font-family: var(--font-body);
          font-size: 0.78rem;
          letter-spacing: 0.14em;
          background: transparent;
          color: var(--sn-ivory);
          border: 1px solid var(--sn-gold-40);
          border-radius: 999px;
          padding: 8px 16px;
          cursor: pointer;
          transition:
            background-color 200ms ease,
            border-color 200ms ease,
            color 200ms ease;
        }
        .ed__chip:hover {
          border-color: var(--sn-gold);
          color: var(--sn-gold);
        }
        .ed__chip--on {
          background: var(--sn-gold);
          color: var(--sn-black);
          border-color: var(--sn-gold);
        }
        .ed__chip--on:hover { color: var(--sn-black); }
      `}</style>
    </section>
  );
}
