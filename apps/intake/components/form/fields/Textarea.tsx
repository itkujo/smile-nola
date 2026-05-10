"use client";

import { forwardRef, useId } from "react";

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helper?: string;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  { label, error, helper, required, className, id, rows = 4, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `ta-${reactId}`;
  const describedById = error
    ? `${inputId}-error`
    : helper
      ? `${inputId}-helper`
      : undefined;

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <label
        htmlFor={inputId}
        className="text-[10px] font-body font-medium uppercase tracking-[0.36em] text-[color:var(--sn-muted-stone)]"
      >
        {label}
        {!required && (
          <span className="ml-2 normal-case tracking-[0.12em] text-[color:var(--sn-muted-stone)] opacity-60">
            (Optional)
          </span>
        )}
      </label>
      <div className="sn-field-wrap relative">
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          aria-invalid={!!error}
          aria-describedby={describedById}
          className="w-full resize-none bg-transparent text-[color:var(--sn-ivory)] font-body text-[16px] leading-relaxed outline-none placeholder:text-[color:var(--sn-muted-stone)] placeholder:opacity-50 caret-[color:var(--sn-gold)]"
          style={{
            paddingTop: "var(--sn-input-padding-y)",
            paddingBottom: "var(--sn-input-padding-y)",
          }}
          {...rest}
        />
        <span className="sn-underline" aria-hidden="true" />
        <span className="sn-underline-glow" aria-hidden="true" />
      </div>
      {error ? (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs font-body text-[color:var(--sn-amber)] tracking-wide"
        >
          {error}
        </p>
      ) : helper ? (
        <p
          id={`${inputId}-helper`}
          className="text-xs font-body text-[color:var(--sn-muted-stone)] opacity-80"
        >
          {helper}
        </p>
      ) : null}
    </div>
  );
});
