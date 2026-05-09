"use client";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  name: string;
  options: readonly Option[] | readonly string[];
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
}

function normalize(options: readonly Option[] | readonly string[]): Option[] {
  return options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
}

/**
 * Single-select chip group. Tap to select; keyboard arrows for accessibility.
 */
export function ChipSelector({
  label,
  name,
  options,
  value,
  onChange,
  error,
  helper,
}: Props) {
  const opts = normalize(options);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[10px] font-body font-medium uppercase tracking-[0.36em] text-[color:var(--sn-muted-stone)]">
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {opts.map((o) => {
          const selected = value === o.value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              key={o.value}
              data-selected={selected}
              className="chip"
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p
          role="alert"
          className="text-xs font-body text-[color:var(--sn-amber)] tracking-wide"
        >
          {error}
        </p>
      ) : helper ? (
        <p className="text-xs font-body text-[color:var(--sn-muted-stone)] opacity-80">
          {helper}
        </p>
      ) : null}
      {/* Hidden input keeps the selection in the form data tree if used outside RHF */}
      <input type="hidden" name={name} value={value ?? ""} />
    </fieldset>
  );
}
