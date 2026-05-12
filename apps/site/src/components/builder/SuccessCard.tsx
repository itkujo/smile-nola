interface Props {
  firstName: string;
}

export function SuccessCard({ firstName }: Props) {
  const safeName = firstName.trim() || "there";
  return (
    <div className="sc" role="status" aria-live="polite">
      <h2 className="sc__title font-deco">thank you, {safeName}.</h2>
      <p className="sc__body">
        Daniel will review your selections and reach out personally within 24 hours.
      </p>

      <style>{`
        .sc {
          max-width: 640px;
          margin: 0 auto;
          padding: clamp(36px, 6vw, 64px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold);
          border-radius: 2px;
          text-align: center;
          box-shadow: 0 0 36px var(--sn-amber-20);
        }
        .sc__title {
          color: var(--sn-gold);
          font-size: clamp(32px, 5vw, 48px);
          line-height: 1.1;
          margin: 0 0 16px;
        }
        .sc__body {
          color: var(--sn-champagne);
          font-size: 1rem;
          line-height: 1.7;
          margin: 0;
        }
      `}</style>
    </div>
  );
}
