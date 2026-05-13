import { useEffect, useRef, useState } from 'react'

export interface VenueValue {
  name: string
  streetAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

interface Suggestion {
  placeId: string
  mainText: string
  secondaryText: string
}

export const EMPTY_VENUE: VenueValue = {
  name: '',
  streetAddress: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  latitude: null,
  longitude: null,
}

interface Props {
  value: VenueValue
  onChange: (v: VenueValue) => void
  label?: string
  placeholder?: string
  id?: string
  required?: boolean
  /** Optional override for the proxy base. Booth uses an absolute URL. */
  proxyBase?: string
  className?: string
}

/**
 * React variant of the venue autocomplete combobox.
 *
 * Used by the package builder's EventDetails component and the booth iPad's
 * StepCelebration. Server-side proxy at proxyBase + '/api/places/...'.
 * Free-text fallback when the user types but never picks (TBD, backyard, etc.).
 */
export function VenueAutocompleteReact({
  value,
  onChange,
  label = 'Venue',
  placeholder = 'Venue name or location',
  id = 'venue',
  required = false,
  proxyBase = '',
  className = '',
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPickedRef = useRef(false)

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    },
    [],
  )

  function update(name: string) {
    if (isPickedRef.current && name !== value.name) {
      // User is editing after a pick — clear the structured address.
      onChange({ ...EMPTY_VENUE, name })
      isPickedRef.current = false
    } else {
      onChange({ ...value, name })
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!name || name.length < 2) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(() => search(name), 250)
  }

  async function search(q: string) {
    try {
      const res = await fetch(
        `${proxyBase}/api/places/autocomplete?q=${encodeURIComponent(q)}`,
      )
      if (!res.ok) {
        setSuggestions([])
        return
      }
      const data: { suggestions: Suggestion[] } = await res.json()
      setSuggestions(data.suggestions ?? [])
      setOpen(true)
      setActiveIndex(-1)
    } catch {
      setSuggestions([])
    }
  }

  async function pick(s: Suggestion) {
    try {
      const res = await fetch(
        `${proxyBase}/api/places/details?id=${encodeURIComponent(s.placeId)}`,
      )
      if (!res.ok) {
        onChange({ ...EMPTY_VENUE, name: s.mainText })
        setOpen(false)
        return
      }
      const data = (await res.json()) as VenueValue
      onChange({
        name: data.name,
        streetAddress: data.streetAddress ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      })
      isPickedRef.current = true
      setOpen(false)
    } catch {
      onChange({ ...EMPTY_VENUE, name: s.mainText })
      setOpen(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      pick(suggestions[activeIndex]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <label className={`venue-ac-react block ${className}`}>
      {label ? <span className="block text-sm mb-1">{label}{required ? ' *' : ''}</span> : null}
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value.name}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
            blurTimerRef.current = setTimeout(() => setOpen(false), 150)
          }}
          className="w-full rounded border px-3 py-2"
        />
        {open && suggestions.length > 0 && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute top-full left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded border bg-white shadow-lg z-50"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(s)
                }}
                className={`px-3 py-2 cursor-pointer ${
                  i === activeIndex ? 'bg-gray-100' : ''
                }`}
              >
                <div className="font-medium">{s.mainText}</div>
                {s.secondaryText && (
                  <div className="text-sm text-gray-600">{s.secondaryText}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  )
}
