/**
 * Canonical pricing catalog for the package builder.
 *
 * Single source of truth for both the React island (client-side rendering and
 * tentative totals) and the server endpoint (authoritative recompute). Edit
 * this file to change prices; nothing else in the codebase should hard-code
 * a builder price.
 *
 * Units: cents (integers). Display layer formats to dollars.
 *
 * Source data: docs/superpowers/handoffs/2026-05-10-package-builder-spec.md
 * §"Collection data and pricing — canonical".
 */

export type PriceType = "fixed" | "starting" | "custom";

export interface AddonConfig {
  id: string;
  name: string;
  /** Cents per unit. null when priceType is "custom" (quoted later). */
  priceCents: number | null;
  priceType: PriceType;
  /** When true the UI renders a quantity stepper. */
  qty?: boolean;
  /** Optional cap on the quantity stepper (e.g., LED expansion max 4). */
  qtyMax?: number;
  /** Short caption rendered next to the price (e.g., "client keeps after event"). */
  note?: string;
}

export interface PackageConfig {
  id: string;
  name: string;
  priceCents: number;
  duration?: string;
  description?: string;
  includes?: string[];
}

export type CollectionId =
  | "smile"
  | "visionary"
  | "digital-atelier"
  | "aurora"
  | "resonance";

export interface CollectionConfig {
  id: CollectionId;
  displayName: string;
  shortDescription: string;
  /** Rendering order across the builder; lower = higher on the page. */
  displayOrder: number;
  rules: {
    /** Smile / Visionary: must pick exactly one base package. */
    requireOneBasePackage?: boolean;
    /** Digital Atelier: may pick one or more services as "packages". */
    allowMultiplePackages?: boolean;
    /** Aurora: 200_000 cents = $2,000 project minimum, evaluated against TOTAL spend. */
    projectMinimumCents?: number;
    /** Resonance: the $2,000 minimum has a single exception (ceremony speaker). */
    minimumExceptionAddonIds?: string[];
  };
  packages: PackageConfig[];
  addons: AddonConfig[];
}

export const COLLECTIONS: CollectionConfig[] = [
  // ============================================================
  // 1. THE SMILE COLLECTION — photo experiences
  // ============================================================
  {
    id: "smile",
    displayName: "The Smile Collection",
    shortDescription:
      "Photo experiences designed to feel like part of the event — polished, guest-friendly, layered into the overall design.",
    displayOrder: 1,
    rules: { requireOneBasePackage: true },
    packages: [
      {
        id: "memory-booth",
        name: "The Memory Booth",
        priceCents: 69500,
        duration: "3 hours",
        description:
          "Refined 3-hour photo experience with custom overlay design, on-site attendant, guest sharing via text/email/QR/gallery, digital gallery.",
      },
      {
        id: "mirror-me",
        name: "The Mirror Me Experience",
        priceCents: 89500,
        duration: "3 hours",
        description:
          "Premium 3-hour interactive mirror booth with branded prints, polished guest flow, custom overlay design, guest sharing, attendant support.",
      },
      {
        id: "mirror-me-all-night",
        name: "The Mirror Me Experience, All Night",
        priceCents: 119500,
        duration: "full event",
        description:
          "Mirror Me for the full event — ideal when you want the booth active throughout.",
      },
    ],
    addons: [
      { id: "smile-additional-hour",  name: "Additional Service Time", priceCents: 15000, priceType: "fixed", qty: true, note: "per hour" },
      { id: "audio-guest-book",       name: "Audio Guest Book — Cherish the Beep", priceCents: 27500, priceType: "fixed" },
      { id: "scrapbook-service",      name: "Scrapbook Service + Album", priceCents: 15000, priceType: "fixed" },
      { id: "backdrop-hedge",         name: "Hedge Wall Backdrop", priceCents: 30000, priceType: "fixed", note: "inventory — stays with Smile NOLA" },
      { id: "backdrop-bayou",         name: "Bayou Fairy Tale Backdrop", priceCents: 25000, priceType: "fixed", note: "inventory — stays with Smile NOLA" },
      { id: "backdrop-basic",         name: "Basic Black or White Backdrop", priceCents: 20000, priceType: "fixed", note: "inventory — stays with Smile NOLA" },
      { id: "custom-props-pack",      name: "Custom Props / Signs — Pack of 5", priceCents: 10000, priceType: "fixed" },
      { id: "red-carpet",             name: "Red Carpet & Stanchions", priceCents: 15000, priceType: "fixed" },
      { id: "booth-uplighting",       name: "Photo Booth Area Uplighting", priceCents: 17500, priceType: "fixed" },
      { id: "backdrop-vinyl",         name: "Custom 8×8 Vinyl Backdrop", priceCents: 30000, priceType: "fixed", note: "client keeps after event" },
      { id: "backdrop-tension",       name: "Custom 8×8 Tension-Fabric Backdrop", priceCents: 45000, priceType: "fixed", note: "client keeps after event" },
    ],
  },

  // ============================================================
  // 2. THE VISIONARY SUITE — cinematic videography
  // ============================================================
  {
    id: "visionary",
    displayName: "The Visionary Suite",
    shortDescription:
      "Cinematic videography for weddings and events that deserve to be remembered with emotion, movement, and intention.",
    displayOrder: 2,
    rules: { requireOneBasePackage: true },
    packages: [
      {
        id: "visionary-highlight",
        name: "Visionary Highlight Film",
        priceCents: 150000,
        description:
          "Cinematic highlight film with founder-led capture, gimbal-stabilized movement, and color-graded delivery — without stepping into full luxury multi-videographer territory.",
        includes: [
          "Founder-led wedding/event day capture",
          "Single videographer coverage",
          "Gimbal-stabilized camera movement",
          "Ceremony and toast audio capture when practical/scoped",
          "Cinematic highlight film",
          "Teaser video",
          "Color-graded delivery",
          "Online delivery link",
        ],
      },
      {
        id: "visionary-signature",
        name: "Visionary Signature Film",
        priceCents: 250000,
        description:
          "Stronger cinematic coverage for events that need more angles, reactions, and a more complete emotional story.",
        includes: [
          "Everything in Visionary Highlight Film",
          "Second shooter",
          "Expanded ceremony/reception coverage",
          "More guest, detail, and reaction coverage",
          "Stronger multi-angle storytelling",
        ],
      },
    ],
    addons: [
      { id: "rehearsal-coverage", name: "Rehearsal Dinner Coverage", priceCents: 50000, priceType: "fixed" },
      { id: "visionary-travel",   name: "Travel Fee", priceCents: null,       priceType: "custom", note: "per travel rules" },
    ],
  },

  // ============================================================
  // 3. THE DIGITAL ATELIER — web + design
  // ============================================================
  {
    id: "digital-atelier",
    displayName: "The Digital Atelier",
    shortDescription:
      "Event websites, RSVP systems, branding, and guest-facing digital design.",
    displayOrder: 3,
    rules: { allowMultiplePackages: true },
    packages: [
      {
        id: "event-logo-brand",
        name: "Event Logo & Brand Design",
        priceCents: 50000,
        description:
          "Custom event logo, monogram, or visual mark for weddings, celebrations, private events, and branded experiences.",
        includes: [
          "Custom event logo / monogram / mark",
          "Basic event color direction",
          "Font / style direction",
          "Digital logo files for event use",
          "Designed for invitations, signage, websites, printed details",
        ],
      },
      {
        id: "event-website-rsvp",
        name: "Event Website & RSVP",
        priceCents: 150000,
        description: "Polished event website + RSVP experience.",
        includes: [
          "Custom event website",
          "Mobile-friendly design",
          "Event details page",
          "RSVP or guest information form",
          "Schedule / location / hotel / registry sections as needed",
          "Launch support",
        ],
      },
      {
        id: "premium-event-experience",
        name: "Premium Event Website & Guest Experience",
        priceCents: 250000,
        description:
          "More complete digital guest experience with expanded design, guest information collection, and stronger event branding integration.",
        includes: [
          "Everything in Event Website & RSVP",
          "Expanded page/section structure",
          "More refined visual design",
          "Custom integration setup",
          "Guest information collection",
          "Custom event branding integration",
          "Post-launch support window",
        ],
      },
    ],
    addons: [
      { id: "extra-page",          name: "Additional website page / section", priceCents: 25000, priceType: "fixed", qty: true },
      { id: "custom-integration",  name: "Custom Integration Setup",          priceCents: 35000, priceType: "fixed" },
      { id: "custom-domain-setup", name: "Custom domain setup",               priceCents: 15000, priceType: "fixed" },
      { id: "digital-invite",      name: "Digital invitation design",         priceCents: 35000, priceType: "fixed" },
      { id: "printed-invite",      name: "Printed invitation design file",    priceCents: 35000, priceType: "fixed" },
      { id: "menu-design",         name: "Menu design",                       priceCents: 15000, priceType: "fixed" },
      { id: "program-design",      name: "Program design",                    priceCents: 25000, priceType: "fixed" },
      { id: "seating-chart",       name: "Seating chart design",              priceCents: 25000, priceType: "fixed" },
      { id: "welcome-sign",        name: "Welcome sign design",               priceCents: 15000, priceType: "fixed" },
      { id: "bar-sign",            name: "Bar / signature drink sign design", priceCents: 12500, priceType: "fixed" },
      { id: "rush-launch",         name: "Rush launch",                       priceCents: 50000, priceType: "fixed" },
      { id: "post-event-gallery",  name: "Post-event gallery page",           priceCents: 35000, priceType: "fixed" },
      { id: "extra-revision",      name: "Additional design revision round",  priceCents: 15000, priceType: "fixed", qty: true },
    ],
  },

  // ============================================================
  // 4. THE AURORA COLLECTION — lighting + LED + staging
  // ============================================================
  {
    id: "aurora",
    displayName: "The Aurora Collection",
    shortDescription:
      "Lighting, LED video walls, staging, and luminous atmosphere. Requires a $2,000 total Smile NOLA project minimum.",
    displayOrder: 4,
    rules: { projectMinimumCents: 200000 },
    packages: [],
    addons: [
      // LED wall
      { id: "led-wall-experience", name: "LED Video Wall Experience",                                         priceCents: 300000, priceType: "fixed",   note: "up to 10 panels · 500mm × 1000mm each" },
      { id: "led-wall-expansion",  name: "LED Wall Expansion",                                                priceCents: 50000,  priceType: "fixed", qty: true, qtyMax: 4, note: "per panel · adds beyond 10" },
      { id: "led-wall-full",       name: "Full LED Wall Experience",                                          priceCents: 500000, priceType: "fixed",   note: "full 14-panel config with expanded support" },

      // Lighting & visual
      { id: "uplighting-apelabs",  name: "ApeLabs Wireless Uplighting",                                       priceCents: 5000,   priceType: "fixed", qty: true, note: "per fixture" },
      { id: "pin-spot-apelabs",    name: "ApeLabs Pin Spot Lighting",                                         priceCents: 7500,   priceType: "fixed", qty: true, note: "per fixture · cakes, florals, sweetheart tables" },
      { id: "neon-pix-apelabs",    name: "ApeLabs Neon Pix",                                                  priceCents: 5000,   priceType: "fixed", qty: true, note: "per fixture · accents, texture" },
      { id: "monogram-projection", name: "Interactive Monogram Projection",                                   priceCents: 50000,  priceType: "starting", note: "advanced effects quoted separately" },
      { id: "dance-floor-lighting",name: "Dance Floor Lighting Package",                                      priceCents: 75000,  priceType: "fixed",   note: "haze/lasers/moving-head upgrades quoted separately" },
      { id: "hazer",               name: "Hazers",                                                            priceCents: 25000,  priceType: "fixed", qty: true, note: "each · subject to venue approval" },
      { id: "lasers",              name: "Lasers",                                                            priceCents: 75000,  priceType: "starting", note: "depends on venue / safety / programming" },
      { id: "moving-head-single",  name: "Moving Heads",                                                      priceCents: 15000,  priceType: "fixed", qty: true, note: "per fixture" },
      { id: "moving-head-4pkg",    name: "Moving Heads Package — 4 Fixtures",                                 priceCents: 50000,  priceType: "fixed" },
      { id: "moving-head-8pkg",    name: "Moving Heads Package — 8 Fixtures",                                 priceCents: 90000,  priceType: "fixed" },

      // Staging
      { id: "stage-section",       name: "Staging — 4×8 Section",                                             priceCents: 12500,  priceType: "fixed", qty: true, note: "per section · final pricing may vary" },
      { id: "stage-steps",         name: "Stage Steps",                                                       priceCents: 7500,   priceType: "fixed" },
      { id: "stage-skirting",      name: "Stage Skirting",                                                    priceCents: 200,    priceType: "fixed", qty: true, note: "per linear foot" },

      // Content & production add-ons
      { id: "custom-visual-loop",  name: "Custom Visual Loop",                                                priceCents: 50000,  priceType: "fixed" },
      { id: "slideshow-build",     name: "Slideshow Build",                                                   priceCents: 35000,  priceType: "fixed" },
      { id: "logo-loop",           name: "Logo Loop / Branded Motion Background",                             priceCents: 35000,  priceType: "fixed" },
      { id: "extra-operator-hour", name: "Extra Operator Hour",                                               priceCents: 12500,  priceType: "fixed", qty: true, note: "per hour" },
      { id: "early-setup",         name: "Additional Load-In / Early Setup",                                  priceCents: 25000,  priceType: "fixed" },
      { id: "outdoor-complexity",  name: "Outdoor / Covered Setup Complexity",                                priceCents: null,   priceType: "custom" },
      { id: "power-distribution",  name: "Power Distribution Support",                                        priceCents: null,   priceType: "custom" },
    ],
  },

  // ============================================================
  // 5. THE RESONANCE SERIES — concert-grade sound
  // ============================================================
  {
    id: "resonance",
    displayName: "The Resonance Series",
    shortDescription:
      "Concert-grade sound for celebrations. Every Resonance proposal begins with a planning conversation; pricing starts at $2,000 except the ceremony-speaker exception.",
    displayOrder: 5,
    rules: { minimumExceptionAddonIds: ["ceremony-speaker", "ceremony-wireless-mic"] },
    packages: [],
    addons: [
      { id: "resonance-minimum",       name: "Resonance Minimum Spend",                                 priceCents: 200000, priceType: "fixed", note: "starting point · planning conversation required" },
      { id: "ceremony-speaker",        name: "Ceremony Speaker À La Carte",                             priceCents: 35000,  priceType: "fixed", note: "the only Resonance item available below the $2,000 minimum" },
      { id: "ceremony-wireless-mic",   name: "Optional wireless microphone",                            priceCents: 15000,  priceType: "fixed", qty: true, note: "add-on to Ceremony Speaker · per mic" },
    ],
  },
];

/* ============================================================================
 * Lookup helpers — both client and server import these.
 * ========================================================================== */

const _collectionById = new Map<CollectionId, CollectionConfig>();
for (const c of COLLECTIONS) _collectionById.set(c.id, c);

export function getCollection(id: string): CollectionConfig | undefined {
  return _collectionById.get(id as CollectionId);
}

export function getPackage(
  collectionId: string,
  packageId: string,
): PackageConfig | undefined {
  return getCollection(collectionId)?.packages.find((p) => p.id === packageId);
}

export function getAddon(
  collectionId: string,
  addonId: string,
): AddonConfig | undefined {
  return getCollection(collectionId)?.addons.find((a) => a.id === addonId);
}

/** All collection ids, in display order. Useful for rendering. */
export const COLLECTION_DISPLAY_ORDER: CollectionId[] = [...COLLECTIONS]
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map((c) => c.id);
