import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAllLeads } from "@/lib/db";
import { collectionLabel, SOURCE_DEFAULT } from "@/lib/schema";
import { GoldDivider } from "@/components/brand/GoldDivider";
import { LogoMark } from "@/components/brand/LogoMark";
import { DeleteLeadButton } from "./DeleteLeadButton";
import { verifyCookie, COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Defense in depth: middleware already redirects unauthed requests away
 * from /admin/*, but we re-check the cookie here so a misconfiguration
 * that bypasses middleware (e.g. a future build that doesn't match the
 * matcher correctly) still doesn't leak captured leads.
 */
async function requireAuth(): Promise<void> {
  const hdrs = await headers();
  const cookieHeader = hdrs.get("cookie");
  const value = cookieHeader
    ? cookieHeader
        .split(/;\s*/)
        .find((p) => p.startsWith(`${COOKIE_NAME}=`))
        ?.slice(COOKIE_NAME.length + 1)
        ?.trim()
    : undefined;
  if (!verifyCookie(value)) {
    redirect("/login?next=/admin");
  }
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function fmtEventDate(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function AdminPage() {
  await requireAuth();
  const leads = getAllLeads();

  return (
    <main className="min-h-screen px-6 py-10 sm:px-12">
      <header className="max-w-6xl mx-auto flex flex-col items-center text-center gap-3 mb-10">
        <LogoMark size={64} color="var(--sn-gold)" />
        <p className="font-body text-[10px] tracking-[0.5em] uppercase text-[color:var(--sn-muted-stone)]">
          {SOURCE_DEFAULT}
        </p>
        <h1
          className="font-deco text-[color:var(--sn-gold)] text-3xl sm:text-4xl tracking-[0.06em] lowercase"
          style={{ textShadow: "0 0 24px var(--sn-amber-20)" }}
        >
          captured leads
        </h1>
        <div className="w-32 mt-1">
          <GoldDivider />
        </div>
        <div className="mt-3 flex items-center gap-4 flex-wrap justify-center">
          <span className="font-body text-sm tracking-[0.2em] uppercase text-[color:var(--sn-champagne)]">
            {leads.length} {leads.length === 1 ? "lead" : "leads"}
          </span>
          <a
            href="/api/export"
            download
            className="btn-gold inline-flex items-center gap-2"
          >
            Download HoneyBook CSV
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1V10M7 10L3 6M7 10L11 6M2 13H12"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
      </header>

      <section className="max-w-6xl mx-auto">
        {leads.length === 0 ? (
          <div className="brand-card rounded-md p-16 text-center">
            <p className="font-body text-[color:var(--sn-champagne)] opacity-80">
              No leads captured yet. Run the booth and they'll appear here.
            </p>
          </div>
        ) : (
          <div className="brand-card rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-body text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.3em] text-[color:var(--sn-muted-stone)]">
                    <th className="py-4 px-4 sm:px-6 font-medium">Captured</th>
                    <th className="py-4 px-4 sm:px-6 font-medium">POC</th>
                    <th className="py-4 px-4 sm:px-6 font-medium">Contact</th>
                    <th className="py-4 px-4 sm:px-6 font-medium">Couple</th>
                    <th className="py-4 px-4 sm:px-6 font-medium">Event</th>
                    <th className="py-4 px-4 sm:px-6 font-medium">Setting</th>
                    <th className="py-4 px-4 sm:px-6 font-medium">Interests</th>
                    <th className="py-4 px-4 sm:px-6 font-medium text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-t border-[color:var(--sn-gold-24)] hover:bg-[color:var(--sn-gold-12)] transition-colors"
                    >
                      <td className="py-4 px-4 sm:px-6 align-top whitespace-nowrap text-[color:var(--sn-muted-stone)]">
                        {fmtDate(lead.capturedAt)}
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="text-[color:var(--sn-ivory)] font-medium">
                            {lead.pocName}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--sn-muted-stone)]">
                            {lead.pocRelationship}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top">
                        <div className="flex flex-col gap-1 text-[color:var(--sn-champagne)]">
                          <a
                            href={`mailto:${lead.pocEmail}`}
                            className="hover:text-[color:var(--sn-gold)] transition-colors"
                          >
                            {lead.pocEmail}
                          </a>
                          <a
                            href={`tel:${lead.pocPhone}`}
                            className="hover:text-[color:var(--sn-gold)] transition-colors"
                          >
                            {lead.pocPhone}
                          </a>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--sn-muted-stone)]">
                            Prefers {lead.preferredContact}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top text-[color:var(--sn-ivory)]">
                        {lead.partner1Name}
                        {lead.partner2Name ? (
                          <>
                            {" "}
                            <span className="text-[color:var(--sn-gold)]">
                              &amp;
                            </span>{" "}
                            {lead.partner2Name}
                          </>
                        ) : null}
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="text-[color:var(--sn-ivory)]">
                            {fmtEventDate(lead.eventDate)}
                          </span>
                          {lead.venueName && (
                            <span className="text-xs text-[color:var(--sn-muted-stone)]">
                              {lead.venueName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top text-[color:var(--sn-champagne)] text-xs">
                        {lead.setting}
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {lead.collectionsInterested.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center px-2 py-0.5 rounded-full border border-[color:var(--sn-gold-40)] text-[10px] uppercase tracking-[0.15em] text-[color:var(--sn-gold)]"
                            >
                              {collectionLabel(id).replace(/^The /, "")}
                            </span>
                          ))}
                        </div>
                        {lead.notes && (
                          <p className="mt-2 text-xs text-[color:var(--sn-muted-stone)] italic max-w-[28ch] truncate">
                            "{lead.notes}"
                          </p>
                        )}
                      </td>
                      <td className="py-4 px-4 sm:px-6 align-top text-right">
                        <DeleteLeadButton id={lead.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <footer className="max-w-6xl mx-auto mt-10 text-center text-xs text-[color:var(--sn-muted-stone)] font-body tracking-[0.2em] uppercase opacity-70">
        <p>Smile NOLA · Booth Admin · Refresh to see new submissions</p>
      </footer>
    </main>
  );
}
