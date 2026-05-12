/**
 * /login — single-password gate for the booth admin.
 *
 * Mirrors the marketing site's /admin/login flow: POST password to
 * /api/login, set httpOnly cookie on success, redirect to ?next= (or /admin).
 *
 * If the user is already authed, redirect immediately so a refresh loop
 * can't loop.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyCookie, COOKIE_NAME } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import { LogoMark } from "@/components/brand/LogoMark";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next =
    params.next && params.next.startsWith("/admin") ? params.next : "/admin";

  const cookieStore = await cookies();
  if (verifyCookie(cookieStore.get(COOKIE_NAME)?.value)) {
    redirect(next);
  }

  return (
    <main className="login-shell">
      <div className="card">
        <div className="head">
          <LogoMark size={56} color="var(--sn-gold)" />
          <p className="eyebrow">— booth admin —</p>
          <h1
            className="font-deco"
            style={{ textShadow: "0 0 24px var(--sn-amber-20)" }}
          >
            password, please.
          </h1>
          <p className="sub">Authorized personnel only.</p>
        </div>

        <LoginForm next={next} />

        <p className="footer">
          <a href="/">← back to the booth form</a>
        </p>
      </div>

      <style>{`
        .login-shell {
          width: 100%;
          max-width: 440px;
          margin: 0 auto;
          padding: 64px 16px;
        }
        .card {
          position: relative;
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          padding: 40px 32px;
        }
        .card::before,
        .card::after {
          content: "";
          position: absolute;
          width: 22px;
          height: 22px;
          border: 1px solid var(--sn-gold);
          pointer-events: none;
        }
        .card::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
        .card::after  { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }

        .head { text-align: center; margin-bottom: 28px; }
        .eyebrow {
          color: var(--sn-gold);
          font-size: 0.7rem;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          margin: 14px 0 8px;
        }
        .head h1 {
          font-weight: 400;
          font-size: clamp(28px, 4vw, 38px);
          color: var(--sn-ivory);
          line-height: 1.05;
          margin: 0;
        }
        .head .sub {
          color: var(--sn-muted-stone);
          font-size: 0.85rem;
          letter-spacing: 0.04em;
          margin: 10px 0 0;
        }

        .footer {
          margin: 24px 0 0;
          text-align: center;
          color: var(--sn-muted-stone);
          font-size: 0.7rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .footer a {
          color: var(--sn-muted-stone);
          transition: color 200ms ease;
          text-decoration: none;
        }
        .footer a:hover { color: var(--sn-gold); }
      `}</style>
    </main>
  );
}
