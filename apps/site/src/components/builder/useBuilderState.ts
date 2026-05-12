import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  BuilderSelections,
  SelectedAddon,
  SelectedPackage,
} from "@/lib/builder/compute";
import type { BuilderProps } from "./Builder";

export type ConsultationPref = "video" | "in_person" | "none";

export interface EventDetailsValue {
  date: string;        // yyyy-mm-dd or ""
  type: string;        // "wedding" | "corporate" | "private" | "other" | ""
  venue: string;
  guestCount: number | null;
  note: string;
}

export interface ContactValue {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface BuilderStateShape extends BuilderSelections {
  event: EventDetailsValue;
  consultationPref: ConsultationPref;
  contact: ContactValue;
}

interface PersistedShape extends BuilderStateShape {
  /** Schema version bump = invalidate stale drafts on breaking changes. */
  _v: 1;
}

type Action =
  | { type: "toggle-collection"; id: string }
  | { type: "select-package"; collectionId: string; packageId: string }
  | { type: "toggle-package"; collectionId: string; packageId: string }
  | { type: "toggle-addon"; collectionId: string; addonId: string; defaultQty: number }
  | { type: "set-addon-qty"; collectionId: string; addonId: string; qty: number }
  | { type: "set-event"; patch: Partial<EventDetailsValue> }
  | { type: "set-consultation"; value: ConsultationPref }
  | { type: "set-contact"; patch: Partial<ContactValue> }
  | { type: "restore"; state: BuilderStateShape }
  | { type: "clear" };

const STORAGE_PREFIX = "sn-builder-v1:";
const DEBOUNCE_MS = 250;

function emptyState(invite: BuilderProps["invite"]): BuilderStateShape {
  return {
    collections: [],
    packages: [],
    addons: [],
    event: {
      date: invite?.prefill.event.date ?? "",
      type: invite?.prefill.event.type ?? "",
      venue: invite?.prefill.event.venue ?? "",
      guestCount: invite?.prefill.event.guestCount ?? null,
      note: "",
    },
    consultationPref: "none",
    contact: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
    },
  };
}

function reducer(state: BuilderStateShape, action: Action): BuilderStateShape {
  switch (action.type) {
    case "toggle-collection": {
      const has = state.collections.includes(action.id);
      if (has) {
        // Removing a collection also drops its packages and addons.
        return {
          ...state,
          collections: state.collections.filter((c) => c !== action.id),
          packages: state.packages.filter((p) => p.collectionId !== action.id),
          addons: state.addons.filter((a) => a.collectionId !== action.id),
        };
      }
      return { ...state, collections: [...state.collections, action.id] };
    }
    case "select-package": {
      // Single-select within a collection (radio behavior).
      const others = state.packages.filter((p) => p.collectionId !== action.collectionId);
      return {
        ...state,
        packages: [...others, { collectionId: action.collectionId, packageId: action.packageId }],
      };
    }
    case "toggle-package": {
      // Multi-select within a collection (Digital Atelier).
      const idx = state.packages.findIndex(
        (p) => p.collectionId === action.collectionId && p.packageId === action.packageId,
      );
      if (idx >= 0) {
        return { ...state, packages: state.packages.filter((_, i) => i !== idx) };
      }
      return {
        ...state,
        packages: [
          ...state.packages,
          { collectionId: action.collectionId, packageId: action.packageId },
        ],
      };
    }
    case "toggle-addon": {
      const idx = state.addons.findIndex(
        (a) => a.collectionId === action.collectionId && a.addonId === action.addonId,
      );
      if (idx >= 0) {
        return { ...state, addons: state.addons.filter((_, i) => i !== idx) };
      }
      return {
        ...state,
        addons: [
          ...state.addons,
          {
            collectionId: action.collectionId,
            addonId: action.addonId,
            qty: action.defaultQty,
          },
        ],
      };
    }
    case "set-addon-qty": {
      return {
        ...state,
        addons: state.addons.map((a) =>
          a.collectionId === action.collectionId && a.addonId === action.addonId
            ? { ...a, qty: action.qty }
            : a,
        ),
      };
    }
    case "set-event":
      return { ...state, event: { ...state.event, ...action.patch } };
    case "set-consultation":
      return { ...state, consultationPref: action.value };
    case "set-contact":
      return { ...state, contact: { ...state.contact, ...action.patch } };
    case "restore":
      return action.state;
    case "clear":
      return emptyState(null);
  }
}

function readPersisted(key: string): BuilderStateShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed._v !== 1) return null;
    // Shallow shape guard — defensive against hand-edited storage.
    if (!Array.isArray(parsed.collections)) return null;
    if (!Array.isArray(parsed.packages)) return null;
    if (!Array.isArray(parsed.addons)) return null;
    const { _v: _ignore, ...rest } = parsed;
    return rest;
  } catch {
    return null;
  }
}

/**
 * Storage key resolution per spec §4.4:
 *   invited → sn-builder-v1:{token}
 *   cold    → sn-builder-v1:{sessionId} (sessionId generated client-side, persisted)
 */
function resolveStorageKey(invite: BuilderProps["invite"]): string | null {
  if (typeof window === "undefined") return null;
  if (invite) return `${STORAGE_PREFIX}${invite.token}`;
  const sessKey = `${STORAGE_PREFIX}__sessionId__`;
  let sid = window.localStorage.getItem(sessKey);
  if (!sid) {
    sid = window.crypto.randomUUID();
    window.localStorage.setItem(sessKey, sid);
  }
  return `${STORAGE_PREFIX}${sid}`;
}

export interface UseBuilderStateReturn extends BuilderStateShape {
  /** True iff the initial mount restored a draft from localStorage. */
  restored: boolean;
  toggleCollection: (id: string) => void;
  selectPackage: (collectionId: string, packageId: string) => void;
  togglePackage: (collectionId: string, packageId: string) => void;
  toggleAddon: (collectionId: string, addonId: string, defaultQty?: number) => void;
  setAddonQty: (collectionId: string, addonId: string, qty: number) => void;
  setEvent: (patch: Partial<EventDetailsValue>) => void;
  setConsultationPref: (value: ConsultationPref) => void;
  setContact: (patch: Partial<ContactValue>) => void;
  clearPersisted: () => void;
}

export function useBuilderState(
  invite: BuilderProps["invite"],
): UseBuilderStateReturn {
  const [state, dispatch] = useReducer(reducer, invite, emptyState);
  const [restored, setRestored] = useState(false);
  const storageKeyRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestoreRef = useRef(false);

  // Resolve key + restore on mount.
  useEffect(() => {
    const key = resolveStorageKey(invite);
    storageKeyRef.current = key;
    if (!key) return;
    const persisted = readPersisted(key);
    if (persisted) {
      dispatch({ type: "restore", state: persisted });
      setRestored(true);
    }
    didRestoreRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change (debounced 250ms), but only AFTER the initial restore
  // pass — otherwise we'd overwrite the saved draft with the empty seed.
  useEffect(() => {
    if (!didRestoreRef.current) return;
    const key = storageKeyRef.current;
    if (!key) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const payload: PersistedShape = { _v: 1, ...state };
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        // Quota or privacy mode — non-fatal; drafts just won't survive.
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state]);

  const toggleCollection = useCallback(
    (id: string) => dispatch({ type: "toggle-collection", id }),
    [],
  );
  const selectPackage = useCallback(
    (collectionId: string, packageId: string) =>
      dispatch({ type: "select-package", collectionId, packageId }),
    [],
  );
  const togglePackage = useCallback(
    (collectionId: string, packageId: string) =>
      dispatch({ type: "toggle-package", collectionId, packageId }),
    [],
  );
  const toggleAddon = useCallback(
    (collectionId: string, addonId: string, defaultQty: number = 1) =>
      dispatch({ type: "toggle-addon", collectionId, addonId, defaultQty }),
    [],
  );
  const setAddonQty = useCallback(
    (collectionId: string, addonId: string, qty: number) =>
      dispatch({ type: "set-addon-qty", collectionId, addonId, qty }),
    [],
  );
  const setEvent = useCallback(
    (patch: Partial<EventDetailsValue>) => dispatch({ type: "set-event", patch }),
    [],
  );
  const setConsultationPref = useCallback(
    (value: ConsultationPref) => dispatch({ type: "set-consultation", value }),
    [],
  );
  const setContact = useCallback(
    (patch: Partial<ContactValue>) => dispatch({ type: "set-contact", patch }),
    [],
  );
  const clearPersisted = useCallback(() => {
    const key = storageKeyRef.current;
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }, []);

  return {
    ...state,
    restored,
    toggleCollection,
    selectPackage,
    togglePackage,
    toggleAddon,
    setAddonQty,
    setEvent,
    setConsultationPref,
    setContact,
    clearPersisted,
  };
}

// Re-export the selection types for callers that don't want to import from
// compute.ts directly. Keeps component prop signatures readable.
export type { SelectedAddon, SelectedPackage };
