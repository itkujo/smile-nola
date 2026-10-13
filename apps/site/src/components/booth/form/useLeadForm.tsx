import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ReactNode,
} from "react";
import type { z } from "zod";
import { LeadSchema } from "@/lib/booth/schema";

/**
 * A small form-state hook for the kiosk, shaped like the few react-hook-form
 * calls the steps used (register / watch / setValue / trigger / errors), so
 * the booth needs no form library. Values are the schema's *input* type;
 * validation is the shared LeadSchema, also used by the API.
 */

export type LeadValues = Partial<z.input<typeof LeadSchema>>;
type Name = keyof z.input<typeof LeadSchema>;
type Errors = Partial<Record<Name, { message: string }>>;

export interface LeadForm {
  values: LeadValues;
  errors: Errors;
  getValues: () => LeadValues;
  watch: <K extends Name>(name: K) => LeadValues[K];
  setValue: <K extends Name>(name: K, value: LeadValues[K], opts?: { shouldValidate?: boolean }) => void;
  /** Controlled-input props for a text-like field. */
  register: (name: Name) => {
    name: Name;
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onBlur: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  };
  /** Validate the named fields now; marks them touched; focuses the first bad one. */
  trigger: (names: readonly Name[], opts?: { shouldFocus?: boolean }) => boolean;
  reset: (values?: LeadValues) => void;
}

function issuesFor(values: LeadValues, names: readonly Name[]): Errors {
  const out: Errors = {};
  const parsed = LeadSchema.safeParse(values);
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as Name | undefined;
    if (key && names.includes(key) && !out[key]) out[key] = { message: issue.message };
  }
  return out;
}

export function useLeadForm(defaults: LeadValues): LeadForm {
  const [values, setValuesState] = useState<LeadValues>(defaults);
  const [errors, setErrors] = useState<Errors>({});
  const ref = useRef<LeadValues>(defaults);
  const touched = useRef<Set<Name>>(new Set());
  const defaultsRef = useRef(defaults);

  const commit = useCallback((next: LeadValues) => {
    ref.current = next;
    setValuesState(next);
  }, []);

  const validateOne = useCallback((name: Name, vals: LeadValues) => {
    const found = issuesFor(vals, [name]);
    setErrors((prev) => {
      const copy = { ...prev };
      if (found[name]) copy[name] = found[name];
      else delete copy[name];
      return copy;
    });
  }, []);

  const setValue = useCallback<LeadForm["setValue"]>(
    (name, value, opts) => {
      const next = { ...ref.current, [name]: value };
      commit(next);
      if (opts?.shouldValidate) validateOne(name, next);
    },
    [commit, validateOne],
  );

  const register = useCallback<LeadForm["register"]>(
    (name) => ({
      name,
      value: String(ref.current[name] ?? ""),
      onChange: (e) => {
        const next = { ...ref.current, [name]: e.target.value };
        commit(next);
        // Once a field has been left (or has an error), re-check as they type.
        if (touched.current.has(name)) validateOne(name, next);
      },
      onBlur: () => {
        touched.current.add(name);
        validateOne(name, ref.current);
      },
    }),
    [commit, validateOne],
  );

  const trigger = useCallback<LeadForm["trigger"]>(
    (names, opts) => {
      for (const n of names) touched.current.add(n);
      const found = issuesFor(ref.current, names);
      setErrors((prev) => {
        const copy = { ...prev };
        for (const n of names) {
          if (found[n]) copy[n] = found[n];
          else delete copy[n];
        }
        return copy;
      });
      const firstBad = names.find((n) => found[n]);
      if (firstBad && opts?.shouldFocus && typeof document !== "undefined") {
        const el = document.querySelector<HTMLElement>(`[name="${firstBad}"]`);
        el?.focus();
      }
      return !firstBad;
    },
    [],
  );

  const reset = useCallback<LeadForm["reset"]>(
    (vals) => {
      touched.current.clear();
      setErrors({});
      commit(vals ?? defaultsRef.current);
    },
    [commit],
  );

  return useMemo<LeadForm>(
    () => ({
      values,
      errors,
      getValues: () => ref.current,
      watch: (name) => values[name],
      setValue,
      register,
      trigger,
      reset,
    }),
    [values, errors, setValue, register, trigger, reset],
  );
}

const Ctx = createContext<LeadForm | null>(null);

export function LeadFormProvider({ form, children }: { form: LeadForm; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: form }, children);
}

export function useLeadFormContext(): LeadForm {
  const form = useContext(Ctx);
  if (!form) throw new Error("useLeadFormContext must be used inside <LeadFormProvider>");
  return form;
}
