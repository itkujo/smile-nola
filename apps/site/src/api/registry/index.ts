/**
 * The operation registry: every API operation, discovered from
 * src/api/v1/ops/**\/*.ts. A new unit adds an ops file; nothing else changes.
 * Any export that is an operation (made by defineOperation) is registered.
 */

import type { AnyOperation } from "./define";
import { METHODS, isOperation } from "./define";
import { createRouter } from "./router";

export * from "./define";
export * from "./errors";
export * from "./scopes";
export * from "./paging";

/**
 * Collect operations from glob-imported modules, rejecting duplicate ids and
 * duplicate method+path. Sorted by tag, then path, then method.
 */
export function collectOperations(modules: Record<string, unknown>): AnyOperation[] {
  const ops: AnyOperation[] = [];
  const ids = new Map<string, string>();
  const routes = new Map<string, string>();
  for (const [file, mod] of Object.entries(modules)) {
    if (typeof mod !== "object" || mod === null) continue;
    for (const value of Object.values(mod as Record<string, unknown>)) {
      if (!isOperation(value)) continue;
      if (ops.includes(value)) continue;
      const prevId = ids.get(value.id);
      if (prevId) throw new Error(`duplicate operation id "${value.id}" in ${file} and ${prevId}`);
      const routeKey = `${value.method} ${value.path}`;
      const prevRoute = routes.get(routeKey);
      if (prevRoute) throw new Error(`duplicate route ${routeKey} in ${file} and ${prevRoute}`);
      ids.set(value.id, file);
      routes.set(routeKey, file);
      ops.push(value);
    }
  }
  return ops.sort(
    (a, b) =>
      a.tag.localeCompare(b.tag) ||
      a.path.localeCompare(b.path) ||
      METHODS.indexOf(a.method) - METHODS.indexOf(b.method),
  );
}

const modules = import.meta.glob(["../v1/ops/**/*.ts", "!../v1/ops/**/*.test.ts"], {
  eager: true,
});

const OPERATIONS: readonly AnyOperation[] = Object.freeze(collectOperations(modules));

export function getOperations(): readonly AnyOperation[] {
  return OPERATIONS;
}

/** Operations grouped by tag, in registry order. */
export function operationsByTag(ops: readonly AnyOperation[] = OPERATIONS): Map<string, AnyOperation[]> {
  const out = new Map<string, AnyOperation[]>();
  for (const op of ops) out.set(op.tag, [...(out.get(op.tag) ?? []), op]);
  return out;
}

let liveRouter: ReturnType<typeof createRouter> | null = null;

/** The router over every registered operation. */
export function getRouter(): ReturnType<typeof createRouter> {
  if (!liveRouter) liveRouter = createRouter({ operations: OPERATIONS });
  return liveRouter;
}
