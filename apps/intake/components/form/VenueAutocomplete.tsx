"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_PROXY_BASE =
  process.env.NEXT_PUBLIC_PROXY_BASE ?? "https://smile-nola.com";

export interface VenueValue {
  name: string;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

export const EMPTY_VENUE: VenueValue = {
  name: "",
  streetAddress: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  latitude: null,
  longitude: null,
};

interface Props {
  value: VenueValue;
  onChange: (v: VenueValue) => void;
  label: string;
  placeholder?: string;
  helper?: string;
  id?: string;
  required?: boolean;
  proxyBase?: string;
}

/**
 * Booth-styled venue autocomplete combobox.
 *
 * Mirrors TextField's visual treatment (uppercase Poppins label, ivory text,
 * transparent bg, gold underline w/ amber glow on focus) so the autocomplete
 * field blends with the rest of the intake form.
 *
 * Calls the SITE's /api/places proxy cross-origin (booth domain != site
 * domain). The site proxy emits Access-Control-Allow-Origin: * headers
 * to permit this. Falls back to free-text entry if the proxy is down
 * or the user types without picking.
 */
export function VenueAutocomplete({
  value,
  onChange,
  label,
  placeholder,
  helper,
  id,
  required = false,
  proxyBase = DEFAULT_PROXY_BASE,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPickedRef = useRef(false);

  const inputId = id ?? "venue-ac-booth";

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    [],
  );

  function update(name: string) {
    if (isPickedRef.current && name !== value.name) {
      onChange({ ...EMPTY_VENUE, name });
      isPickedRef.current = false;
    } else {
      onChange({ ...value, name });
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!name || name.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => search(name), 250);
  }

  async function search(q: string) {
    try {
      const res = await fetch(
        `${proxyBase}/api/places/autocomplete?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) {
        setSuggestions([]);
        return;
      }
      const data: { suggestions: Suggestion[] } = await res.json();
      setSuggestions(data.suggestions ?? []);
      setOpen(true);
      setActiveIndex(-1);
    } catch {
      setSuggestions([]);
    }
  }

  async function pick(s: Suggestion) {
    try {
      const res = await fetch(
        `${proxyBase}/api/places/details?id=${encodeURIComponent(s.placeId)}`,
      );
      if (!res.ok) {
        onChange({ ...EMPTY_VENUE, name: s.mainText });
        setOpen(false);
        return;
      }
      const data = (await res.json()) as VenueValue;
      onChange({
        name: data.name,
        streetAddress: data.streetAddress ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      });
      isPickedRef.current = true;
      setOpen(false);
    } catch {
      onChange({ ...EMPTY_VENUE, name: s.mainText });
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(suggestions[activeIndex]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
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
        <input
          id={inputId}
          type="text"
          value={value.name}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${inputId}-listbox`}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
          className="w-full bg-transparent text-[color:var(--sn-ivory)] font-body text-[16px] outline-none placeholder:text-[color:var(--sn-muted-stone)] placeholder:opacity-50 caret-[color:var(--sn-gold)]"
          style={{
            paddingTop: "var(--sn-input-padding-y)",
            paddingBottom: "var(--sn-input-padding-y)",
          }}
        />
        <span className="sn-underline" aria-hidden="true" />
        <span className="sn-underline-glow" aria-hidden="true" />
        {open && suggestions.length > 0 && (
          <ul
            id={`${inputId}-listbox`}
            role="listbox"
            className="absolute top-full left-0 right-0 mt-2 max-h-72 overflow-y-auto rounded border border-[color:var(--sn-gold-40)] bg-[color:var(--sn-soft-black)] shadow-lg z-50"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className={`px-4 py-3 cursor-pointer ${
                  i === activeIndex
                    ? "bg-[color:var(--sn-gold-24)]"
                    : "hover:bg-[color:var(--sn-gold-24)]"
                }`}
              >
                <div className="font-body text-[color:var(--sn-ivory)] text-base">
                  {s.mainText}
                </div>
                {s.secondaryText && (
                  <div className="font-body text-xs text-[color:var(--sn-muted-stone)] opacity-80 mt-0.5">
                    {s.secondaryText}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {helper ? (
        <p className="text-xs font-body text-[color:var(--sn-muted-stone)] opacity-80">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
