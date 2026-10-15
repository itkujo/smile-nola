import Database from "better-sqlite3";
import { bootstrapSchema } from "@/lib/db";
import { issueSessionCookie } from "@/lib/auth";
import { _setTokenDb } from "../tokens";
import { createRouter, type ApiHandler } from "../router";
import { RateLimiter } from "../ratelimit";
import type { AnyOperation } from "../define";

export const BASE = "http://localhost:4321/api/v1";

/** Fresh in-memory DB wired into the token store. */
export function freshDb(): Database.Database {
  const db = new Database(":memory:");
  bootstrapSchema(db);
  _setTokenDb(db);
  return db;
}

export function sessionCookie(): string {
  process.env.ADMIN_SESSION_SECRET ??= "test-secret-at-least-16-chars";
  const c = issueSessionCookie();
  return `${c.name}=${c.value}`;
}

export const silentLogger = { warn: () => {}, error: () => {} };

export function makeRouter(
  operations: readonly AnyOperation[],
  limiter = new RateLimiter(),
  logger: Pick<Console, "warn" | "error"> = silentLogger,
): ApiHandler {
  return createRouter({ operations, limiter, logger });
}

export function req(
  path: string,
  init: RequestInit & { token?: string; cookie?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(BASE + path, { ...init, headers });
}

export function jsonReq(
  path: string,
  method: string,
  body: unknown,
  extra: { token?: string; cookie?: string } = {},
): Request {
  return req(path, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...extra,
  });
}
