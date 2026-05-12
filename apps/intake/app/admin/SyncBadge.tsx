"use client";

/**
 * Sync status pill shown in the booth admin header. Polls
 * /api/sync/status every 15 seconds and renders the pending count
 * plus the last-run outcome. A "Sync now" button calls /api/sync/drain
 * for an immediate flush (useful before closing the laptop at the end
 * of an expo).
 *
 * Failure modes:
 *   - Sync not configured (no INTAKE_SYNC_URL/TOKEN): renders nothing.
 *     Local-only booth setups don't need a sync surface.
 *   - Pending = 0 + last run ok: small champagne "All caught up".
 *   - Pending > 0 + last run ok: amber "X pending" with a manual sync
 *     button.
 *   - Last run failed: amber "Sync issue", expand to see the message.
 */

import { useCallback, useEffect, useState } from "react";

interface SyncStatus {
  pending: number;
  configured: boolean;
  lastRun: { at: string; ok: boolean; message: string } | null;
}

const POLL_MS = 15_000;

export function SyncBadge() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [draining, setDraining] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean } & SyncStatus;
      if (data.ok) {
        setStatus({
          pending: data.pending,
          configured: data.configured,
          lastRun: data.lastRun,
        });
      }
    } catch {
      /* swallow — next tick will retry */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setDraining(true);
    try {
      const res = await fetch("/api/sync/drain", {
        method: "POST",
        cache: "no-store",
      });
      // Don't throw on !ok — the result is already informative in the
      // periodic refresh; just re-poll status.
      void res;
    } catch {
      /* network error; periodic poll will surface lastRun */
    } finally {
      await refresh();
      setDraining(false);
    }
  }, [refresh]);

  if (!status || !status.configured) return null;

  const isError = status.lastRun !== null && !status.lastRun.ok;
  const tone =
    isError || status.pending > 0 ? "amber" : "champagne";
  const label =
    status.pending === 0
      ? isError
        ? "Sync issue"
        : "All caught up"
      : `${status.pending} pending`;

  return (
    <div className={`sync-badge sync-badge--${tone}`}>
      <span className="sync-badge__dot" aria-hidden="true" />
      <span className="sync-badge__label">{label}</span>
      {status.pending > 0 && (
        <button
          type="button"
          className="sync-badge__btn"
          onClick={syncNow}
          disabled={draining}
        >
          {draining ? "Syncing…" : "Sync now"}
        </button>
      )}
      {isError && status.lastRun !== null && (
        <span className="sync-badge__detail" title={status.lastRun.message}>
          ⓘ
        </span>
      )}
      <style>{`
        .sync-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          font-family: var(--font-body);
          font-size: 0.72rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          border: 1px solid;
        }
        .sync-badge--champagne {
          color: var(--sn-champagne);
          border-color: var(--sn-gold-24);
          background: rgba(212, 175, 55, 0.04);
        }
        .sync-badge--amber {
          color: var(--sn-amber);
          border-color: var(--sn-amber);
          background: rgba(255, 178, 63, 0.06);
        }
        .sync-badge__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
        .sync-badge__label {
          white-space: nowrap;
        }
        .sync-badge__btn {
          background: transparent;
          border: 0;
          color: currentColor;
          font: inherit;
          letter-spacing: inherit;
          text-transform: inherit;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
        }
        .sync-badge__btn:disabled {
          opacity: 0.5;
          cursor: progress;
        }
        .sync-badge__detail {
          cursor: help;
        }
      `}</style>
    </div>
  );
}
