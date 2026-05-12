import type { ConsultationPref } from "./useBuilderState";

interface Props {
  value: ConsultationPref;
  onChange: (next: ConsultationPref) => void;
}

interface Option {
  value: ConsultationPref;
  label: string;
  caption: string;
}

const OPTIONS: ReadonlyArray<Option> = [
  {
    value: "video",
    label: "A quick video call would be great",
    caption: "We'll send a Google Meet link.",
  },
  {
    value: "in_person",
    label: "An in-person walkthrough makes sense for this event",
    caption: "For complex production setups.",
  },
  {
    value: "none",
    label: "No call needed — the details above are enough",
    caption: "",
  },
];

export function ConsultationPreference({ value, onChange }: Props) {
  return (
    <section
      className="cp"
      role="region"
      aria-labelledby="cp-heading"
    >
      <h2 id="cp-heading" className="cp__label">
        Consultation preference
      </h2>

      <div role="radiogroup" aria-labelledby="cp-heading" className="cp__group">
        {OPTIONS.map((opt) => {
          const id = `cp-${opt.value}`;
          const on = value === opt.value;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={`cp__opt${on ? " cp__opt--on" : ""}`}
            >
              <input
                id={id}
                type="radio"
                name="consultationPref"
                value={opt.value}
                checked={on}
                onChange={() => onChange(opt.value)}
                className="cp__radio"
              />
              <span className="cp__body">
                <span className="cp__title">{opt.label}</span>
                {opt.caption && <span className="cp__caption">{opt.caption}</span>}
              </span>
            </label>
          );
        })}
      </div>

      <p className="cp__caveat">We'll confirm based on project needs.</p>

      <style>{`
        .cp {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .cp__label {
          font-family: var(--font-body);
          font-size: 1.05rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cp__group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cp__opt {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px;
          align-items: start;
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.22);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
          cursor: pointer;
          transition: border-color 200ms ease, background-color 200ms ease;
        }
        .cp__opt:hover { border-color: var(--sn-gold-40); }
        .cp__opt--on {
          border-color: var(--sn-gold);
          background: rgba(212, 175, 55, 0.05);
        }
        .cp__radio {
          margin-top: 3px;
          accent-color: var(--sn-gold);
        }
        .cp__body {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cp__title {
          font-size: 0.95rem;
          color: var(--sn-ivory);
        }
        .cp__caption {
          font-size: 0.8rem;
          color: var(--sn-muted-stone);
        }
        .cp__caveat {
          font-size: 0.78rem;
          color: var(--sn-muted-stone);
          font-style: italic;
          margin: 0;
        }
      `}</style>
    </section>
  );
}
