/**
 * The five Smile NOLA collections — single source of truth.
 *
 * Used by every collection-related surface (homepage stack, /collections
 * overview, each /collections/<slug> page, the deep-form collection toggles,
 * the footer Discover column, and the admin portfolio/inquiry filters).
 *
 * ORDERING RULE
 * -------------
 * Array order = display order on every public surface.
 *
 * Priority:
 *   1. Marketing emphasis (most-pushed services lead).
 *   2. Customer-journey position (early-in-timeline services float up among
 *      lower-priority groupings).
 *
 * The current canonical order, per owner direction:
 *   1. Smile             (photo booth)            — most-pushed
 *   2. Visionary         (videography)            — second-pushed
 *   3. Digital Atelier   (web + design)           — early in customer journey
 *   4. Aurora            (lighting · video walls) — atmosphere
 *   5. Resonance         (concert-grade sound)    — finishing layer
 *
 * Slugs MUST match the booth intake's collection IDs (see
 * apps/intake/lib/schema.ts) so inquiry data is portable across both apps.
 */

import type { CollectionId } from "./collection-id";

export interface InquiryFieldSpec {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "radio" | "checkbox" | "number";
  required?: boolean;
  options?: readonly string[];
  placeholder?: string;
  help?: string;
}

export interface Collection {
  slug: CollectionId;
  displayName: string;       // "The Aurora Collection"
  shortName: string;         // "Aurora"
  tagline: string;           // one-line description for nav, cards
  philosophy: string;        // 1-2 short paragraphs (homepage card body)
  philosophyLong: string;    // 2-3 paragraph version (collection page)
  whatsIncluded: readonly string[];
  inquiryFormFields: readonly InquiryFieldSpec[];
  /**
   * Path under /images/collections/ — or null if no real photo yet (the card
   * will render a typographic placeholder).
   */
  heroImage: string | null;
  cta: string;
}

/* ============================================================================
 * Brand-voice copy comes from the Brand Brief §13 starting drafts, adapted
 * slightly for web pacing. Owner can revise without code changes.
 * ============================================================================ */

export const COLLECTIONS: readonly Collection[] = [
  // 1) SMILE — most-pushed service.
  {
    slug: "smile",
    displayName: "The Smile Collection",
    shortName: "Smile",
    tagline: "photo booth experiences · mirror booth · social stem",
    philosophy:
      "Interactive photo booth experiences designed to give guests a polished, memorable, and shareable moment. The Mirror Me Booth is our premium mirror-style activation.",
    philosophyLong:
      "Photo experiences that don't feel like a county fair. The Smile Collection brings the Mirror Me Booth and the Social Stem Booth — premium, branded photo activations that look like part of your décor, not an afterthought rolled in on a luggage cart.\n\nCustom overlay templates, brand-matched prints, guest sharing via text, email, QR, and a gallery your guests can keep returning to weeks after the night ends.",
    whatsIncluded: [
      "Mirror Me Booth (premium mirror-style touchscreen activation)",
      "Social Stem Booth (compact open-air social-first booth)",
      "Custom overlay template designed to match your event",
      "Unlimited prints + digital sharing (text, email, QR, gallery)",
      "On-site attendant for the full activation window",
    ],
    inquiryFormFields: [
      {
        name: "booth_preference",
        label: "Booth preference",
        type: "select",
        options: ["Mirror Me Booth", "Social Stem Booth", "Not sure — open to recommendation"],
      },
      {
        name: "backdrop_placement",
        label: "Desired backdrop or booth placement",
        type: "textarea",
      },
      {
        name: "prints_needed",
        label: "Prints needed?",
        type: "select",
        options: ["Yes — unlimited", "Yes — limited", "Digital only"],
      },
      {
        name: "needs_custom_overlay",
        label: "Custom overlay / template needed?",
        type: "select",
        options: ["Yes", "No", "Not sure"],
      },
      {
        name: "guest_sharing",
        label: "Guest sharing needs",
        type: "textarea",
        placeholder: "Text, email, QR, gallery, all of the above…",
      },
      {
        name: "setting",
        label: "Indoor or outdoor & power access",
        type: "textarea",
      },
      {
        name: "activation_hours",
        label: "Preferred activation hours",
        type: "text",
        placeholder: "e.g. 7pm-11pm during reception",
      },
    ],
    heroImage: null,
    cta: "Start Your Smile Inquiry",
  },

  // 2) VISIONARY — second-pushed service.
  {
    slug: "visionary",
    displayName: "The Visionary Suite",
    shortName: "Visionary",
    tagline: "cinematic videography · storytelling · memory",
    philosophy:
      "Cinematic storytelling for weddings and events that deserve to be remembered with emotion, movement, and intention.",
    philosophyLong:
      "Photos catch the moment. Film catches the feeling. The Visionary Suite is for couples and clients who want their day told back to them with the pacing and emotional weight it actually had.\n\nWe shoot with gimbal-stabilized cinema cameras, capture sync sound from ceremony and toasts, and edit with a narrative arc — not just a highlight reel of pretty shots, but a story that holds together end to end.",
    whatsIncluded: [
      "Multi-camera coverage (1-3 operators, scoped to your day)",
      "Cinema-grade gimbal + lens kit",
      "Sync sound for ceremony, toasts, first dance",
      "Highlight film (3-6 min) + optional full-feature edit",
      "Color graded and delivered in 4K",
    ],
    inquiryFormFields: [
      {
        name: "coverage",
        label: "Coverage needed",
        type: "textarea",
        placeholder: "Highlight film, ceremony, reception, full day, social clips…",
      },
      {
        name: "locations_count",
        label: "Number of locations on the day",
        type: "number",
      },
      {
        name: "style_preference",
        label: "Preferred style",
        type: "select",
        options: ["Cinematic", "Documentary", "Social-first", "Luxury editorial", "Not sure yet"],
      },
      {
        name: "important_moments",
        label: "Important moments to capture",
        type: "textarea",
        placeholder: "First look, vows, parents, special toasts, surprise moments…",
      },
      {
        name: "delivery_timeline",
        label: "Delivery timeline preference",
        type: "text",
        placeholder: "e.g. teaser within 7 days, full film within 8 weeks",
      },
    ],
    heroImage: null,
    cta: "Start Your Visionary Inquiry",
  },

  // 3) DIGITAL ATELIER — top of the "less-pushed" group; early in customer journey.
  {
    slug: "digital-atelier",
    displayName: "The Digital Atelier",
    shortName: "Digital Atelier",
    tagline: "event websites · branding · guest design",
    philosophy:
      "Custom digital experiences, event websites, inquiry flows, and design touchpoints that make the guest journey feel seamless before the event even begins.",
    philosophyLong:
      "The first thing your guests experience isn't the venue — it's the invitation, the RSVP, the wedding website, the map link they pull up at 11pm the night before. The Digital Atelier designs every one of those touchpoints with the same care you'd put into the day itself.\n\nWe build event websites that match your aesthetic, RSVP systems that work, brand collateral for signage and print, and the small digital details that quietly elevate the whole experience.",
    whatsIncluded: [
      "Custom event website (single page or multi-page)",
      "RSVP and guest information collection",
      "Branded invitation suite and print collateral",
      "Logo and visual identity work",
      "Wedding-day signage, menu, and program design",
    ],
    inquiryFormFields: [
      {
        name: "project_type",
        label: "Project type",
        type: "textarea",
        placeholder:
          "Event website, RSVP form, brand page, digital invitation, custom form, graphic design…",
      },
      {
        name: "launch_date",
        label: "Launch date needed",
        type: "text",
      },
      {
        name: "required_pages",
        label: "Required pages or sections",
        type: "textarea",
      },
      {
        name: "needs_rsvp",
        label: "Do you need RSVP / guest data collection?",
        type: "select",
        options: ["Yes", "No", "Not sure yet"],
      },
      {
        name: "brand_assets",
        label: "Brand assets available?",
        type: "select",
        options: [
          "Yes — full brand kit",
          "Some logos and colors",
          "Nothing yet — start from scratch",
        ],
      },
      {
        name: "inspiration_links",
        label: "Inspiration links or notes",
        type: "textarea",
      },
    ],
    heroImage: null,
    cta: "Start Your Atelier Inquiry",
  },

  // 4) AURORA — atmospheric upgrade.
  {
    slug: "aurora",
    displayName: "The Aurora Collection",
    shortName: "Aurora",
    tagline: "lighting · video walls · luminous atmospheres",
    philosophy:
      "Immersive lighting and visual experiences designed to transform the room, frame the moment, and create a cinematic atmosphere your guests feel the second they arrive.",
    philosophyLong:
      "Aurora is what people remember before the first toast. It's the wash of warm gold across the back wall, the seamless LED video wall behind the head table, the lighting cue that lifts the room at the perfect beat.\n\nDesigned for couples and planners who think about the room the way a cinematographer thinks about a frame — every light placed with intent, every color in service of the story you're telling.",
    whatsIncluded: [
      "Programmable LED lighting design with on-site operator",
      "Seamless LED video wall (modular, indoor or covered outdoor)",
      "Uplighting, pin-spots, and architectural wash",
      "Custom content: slideshow, logo loop, video, live camera feed",
      "Pre-event lighting consult and venue walkthrough",
    ],
    inquiryFormFields: [
      {
        name: "video_wall_size",
        label: "Desired video wall size or visual goal",
        type: "textarea",
        placeholder: "e.g. 16ft × 9ft behind the head table",
      },
      {
        name: "setting",
        label: "Indoor or outdoor setup",
        type: "select",
        options: ["Indoor", "Outdoor — Covered", "Outdoor — Uncovered", "Not sure yet"],
      },
      {
        name: "content_source",
        label: "Content source(s)",
        type: "textarea",
        placeholder: "Slideshow, logo loop, video playback, live camera feed, custom visuals…",
      },
      {
        name: "stage_or_backdrop",
        label: "Stage or backdrop use?",
        type: "text",
        placeholder: "Behind a stage, ceremony backdrop, dance floor, etc.",
      },
      {
        name: "load_in_time",
        label: "Available setup / load-in time",
        type: "text",
        placeholder: "e.g. 4 hours before guests arrive",
      },
      {
        name: "power_notes",
        label: "Power availability (if known)",
        type: "text",
      },
    ],
    heroImage: null,
    cta: "Start Your Aurora Inquiry",
  },

  // 5) RESONANCE — finishing layer.
  {
    slug: "resonance",
    displayName: "The Resonance Series",
    shortName: "Resonance",
    tagline: "concert-grade sound · clarity · presence",
    philosophy:
      "Concert-grade sound for celebrations that need more than volume. The Resonance Series is built for clarity, presence, and a polished audio experience from first toast to final song.",
    philosophyLong:
      "Most events lose people at the toasts because no one can actually hear them. Resonance is built around that problem — designed so every word, every note, every moment lands the way it was meant to.\n\nDeployed with line-array PA, professional monitors, and an on-site engineer who tunes the room before doors. Whether it's a ceremony in a stone courtyard, a reception in a ballroom, or a live band closing the night, the system is sized and tuned for that exact space.",
    whatsIncluded: [
      "Line-array PA system sized to your venue",
      "On-site sound engineer for the full event",
      "Wireless microphones for ceremony, toasts, MC",
      "Stage monitors and front-of-house mix for live bands",
      "Pre-event audio consult with planner and venue",
    ],
    inquiryFormFields: [
      {
        name: "event_type_detail",
        label: "Event type",
        type: "select",
        options: [
          "Ceremony only",
          "Reception only",
          "Ceremony + reception",
          "Live band",
          "DJ",
          "Corporate event",
          "Speaking engagement",
          "Other",
        ],
      },
      {
        name: "performer_count",
        label: "Number of performers or speakers",
        type: "number",
      },
      {
        name: "setting",
        label: "Indoor or outdoor",
        type: "select",
        options: ["Indoor", "Outdoor — Covered", "Outdoor — Uncovered", "Mixed"],
      },
      {
        name: "audience_size",
        label: "Expected audience size",
        type: "number",
      },
      {
        name: "needs_mics",
        label: "Need wireless microphones?",
        type: "select",
        options: ["Yes", "No", "Not sure"],
      },
      {
        name: "needs_engineer",
        label: "Want a sound engineer on-site?",
        type: "select",
        options: ["Yes — full event", "Yes — partial", "No"],
      },
      {
        name: "needs_monitors_foh",
        label: "Stage monitors or front-of-house system needed?",
        type: "textarea",
        placeholder: "e.g. wedge monitors for the band, FOH for vocals…",
      },
    ],
    heroImage: null,
    cta: "Start Your Resonance Inquiry",
  },
];

export function collectionBySlug(slug: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}
