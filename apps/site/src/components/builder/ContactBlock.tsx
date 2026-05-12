import type { ContactValue } from "./useBuilderState";

interface Props {
  value: ContactValue;
  onChange: (patch: Partial<ContactValue>) => void;
}

export function ContactBlock({ value, onChange }: Props) {
  return (
    <section
      className="cb"
      role="region"
      aria-labelledby="cb-heading"
    >
      <h2 id="cb-heading" className="cb__label">
        Your contact details
      </h2>
      <p className="cb__hint">
        So Daniel can follow up directly with your proposal.
      </p>

      <div className="cb__grid">
        <label className="sn-field-wrap">
          <span className="sn-field-label">First name *</span>
          <input
            type="text"
            required
            value={value.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            autoComplete="given-name"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Last name *</span>
          <input
            type="text"
            required
            value={value.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            autoComplete="family-name"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Email *</span>
          <input
            type="email"
            required
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            autoComplete="email"
            inputMode="email"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Phone *</span>
          <input
            type="tel"
            required
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            autoComplete="tel"
            inputMode="tel"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>
      </div>

      <style>{`
        .cb {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .cb__label {
          font-family: var(--font-body);
          font-size: 1.05rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cb__hint {
          color: var(--sn-muted-stone);
          font-size: 0.88rem;
          margin: 0;
        }
        .cb__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 22px 18px;
        }
        @media (max-width: 540px) {
          .cb__grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
