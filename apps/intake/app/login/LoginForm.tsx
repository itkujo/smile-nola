"use client";

/**
 * Login form (client component). Posts to /api/login; on success the server
 * sets the session cookie and we hard-navigate to `next` so the middleware
 * sees the new cookie immediately.
 */

import { useState, useTransition } from "react";

interface Props {
  next: string;
}

export function LoginForm({ next }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
      } catch {
        setError("Network error. Try again.");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        remainingAttempts?: number;
      };

      if (res.ok) {
        // Hard navigate so the middleware re-evaluates with the new cookie.
        window.location.href = next;
        return;
      }

      if (res.status === 429) {
        setError(data.error ?? "Too many attempts. Please wait a moment.");
      } else if (typeof data.remainingAttempts === "number") {
        setError(
          `${data.error ?? "Incorrect password."} (${data.remainingAttempts} attempts remaining)`,
        );
      } else {
        setError(data.error ?? "Login failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label className="sn-field-wrap">
        <span className="sn-field-label">Password</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="sn-underline" />
        <span className="sn-underline-glow" />
      </label>

      {error !== null && (
        <p className="error" role="alert" aria-live="polite">
          {error}
        </p>
      )}

      <button type="submit" className="btn-gold submit-btn" disabled={pending}>
        {pending ? "Verifying…" : "Enter"}
      </button>

      <style>{`
        .sn-field-wrap input {
          width: 100%;
          background: transparent;
          border: 0;
          padding: 12px 0;
          color: var(--sn-ivory);
          font-size: 1rem;
          font-family: var(--font-body);
        }
        .sn-field-wrap input:focus { outline: none; }
        .error {
          margin: 18px 0 0;
          color: var(--sn-amber);
          font-size: 0.85rem;
        }
        .submit-btn {
          margin-top: 28px;
          width: 100%;
          text-align: center;
        }
      `}</style>
    </form>
  );
}
