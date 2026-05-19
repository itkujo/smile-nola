import { useEffect, useMemo, useState } from "react";
import type { BuilderSelections } from "@/lib/builder/compute";
import { computeSubmission } from "@/lib/builder/compute";
import { COLLECTIONS } from "@/lib/builder/catalog";
import { useBuilderState } from "./useBuilderState";
import { CollectionChips } from "./CollectionChips";
import { CollectionSection } from "./CollectionSection";
import { EventDetails } from "./EventDetails";
import { ConsultationPreference } from "./ConsultationPreference";
import { ContactBlock } from "./ContactBlock";
import { InvestmentRail } from "./InvestmentRail";
import { MobileRailBar } from "./MobileRailBar";
import { SuccessCard } from "./SuccessCard";
import "./builder.css";

export interface BuilderProps {
  invite: {
    token: string;
    inquiryId: number;
    prefill: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      event: {
        date: string | null;
        type: string | null;
        venue: string | null;
        guestCount: number | null;
      };
    };
  } | null;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  | { kind: "success"; firstName: string };

export function Builder({ invite }: BuilderProps) {
  const state = useBuilderState(invite);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [welcomeBackVisible, setWelcomeBackVisible] = useState(state.restored);

  useEffect(() => {
    if (state.restored) setWelcomeBackVisible(true);
  }, [state.restored]);

  // Client-side tentative compute — same function the server uses.
  const preview = useMemo(() => {
    const selections: BuilderSelections = {
      collections: state.collections,
      packages: state.packages,
      addons: state.addons,
    };
    return computeSubmission(selections);
  }, [state.collections, state.packages, state.addons]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitState.kind === "sending") return;

    setSubmitState({ kind: "sending" });

    const firstName = invite ? invite.prefill.firstName : state.contact.firstName;
    const lastName = invite ? invite.prefill.lastName : state.contact.lastName;
    const email = invite ? invite.prefill.email : state.contact.email;
    const phone = invite ? invite.prefill.phone : state.contact.phone;

    const body = {
      invite: invite?.token,
      client: { firstName, lastName, email, phone },
      event: {
        date: state.event.date || null,
        type: state.event.type || null,
        venue: state.event.venue || null,
        venue_street_address: state.event.venueStreetAddress,
        venue_city: state.event.venueCity,
        venue_state: state.event.venueState,
        venue_postal_code: state.event.venuePostalCode,
        venue_country: state.event.venueCountry,
        venue_latitude: state.event.venueLatitude,
        venue_longitude: state.event.venueLongitude,
        guestCount: state.event.guestCount ?? null,
        note: state.event.note || null,
      },
      consultationPref: state.consultationPref,
      selections: {
        collections: state.collections,
        packages: state.packages,
        addons: state.addons,
      },
    };

    try {
      const res = await fetch("/api/package-builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error("[Builder] submit failed", res.status, await res.text().catch(() => ""));
        setSubmitState({
          kind: "error",
          message:
            "Something went wrong on our end. Your selections are saved — give it another try in a moment, or email daniel@smile-nola.com.",
        });
        return;
      }
      state.clearPersisted();
      setSubmitState({ kind: "success", firstName });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Builder] submit threw", err);
      setSubmitState({
        kind: "error",
        message:
          "Something went wrong on our end. Your selections are saved — give it another try in a moment, or email daniel@smile-nola.com.",
      });
    }
  }

  if (submitState.kind === "success") {
    return (
      <div className="builder">
        <div className="builder__main">
          <SuccessCard firstName={submitState.firstName} />
        </div>
      </div>
    );
  }

  const eyebrowText = invite
    ? `building for ${invite.prefill.firstName} ${invite.prefill.lastName} · ${
        invite.prefill.event.date || invite.prefill.event.type || "your event"
      }`
    : null;

  return (
    <form className="builder" onSubmit={handleSubmit} noValidate>
      <div className="builder__main">
        {eyebrowText && <p className="builder__eyebrow">{eyebrowText}</p>}

        <h1 className="builder__headline">build your smile nola event experience</h1>

        <p className="builder__intro">
          Tell us what you're imagining — collection by collection, layer by layer. Pick the
          experiences that fit, add the details that matter, and we'll come back with a
          consultative proposal within 24 hours. Nothing here is a commitment; this is the
          shape of the night, sketched together.
        </p>

        {welcomeBackVisible && (
          <div className="builder__welcome-toast" role="status">
            <span>Welcome back. Your selections are saved.</span>
            <button type="button" onClick={() => setWelcomeBackVisible(false)}>
              dismiss
            </button>
          </div>
        )}

        <CollectionChips
          selected={state.collections}
          onToggle={state.toggleCollection}
        />

        {COLLECTIONS.filter((c) => state.collections.includes(c.id))
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((c) => (
            <CollectionSection
              key={c.id}
              collection={c}
              selectedPackages={state.packages.filter((p) => p.collectionId === c.id)}
              selectedAddons={state.addons.filter((a) => a.collectionId === c.id)}
              onSelectPackage={state.selectPackage}
              onTogglePackage={state.togglePackage}
              onToggleAddon={state.toggleAddon}
              onSetAddonQty={state.setAddonQty}
            />
          ))}

        <EventDetails
          value={state.event}
          onChange={state.setEvent}
        />

        <ConsultationPreference
          value={state.consultationPref}
          onChange={state.setConsultationPref}
        />

        {invite === null && (
          <ContactBlock
            value={state.contact}
            onChange={state.setContact}
          />
        )}

        {submitState.kind === "error" && (
          <div className="builder__error-banner" role="alert">
            {submitState.message}
          </div>
        )}

        <div className="builder__submit-row">
          <button
            type="submit"
            className="btn-gold"
            disabled={submitState.kind === "sending"}
          >
            {submitState.kind === "sending" ? "Sending…" : "Send My Selections"}
          </button>
        </div>
      </div>

      <aside className="builder__rail" role="complementary" aria-label="Investment summary">
        <InvestmentRail
          state={state}
          preview={preview}
        />
      </aside>

      <MobileRailBar
        state={state}
        preview={preview}
      />
    </form>
  );
}
