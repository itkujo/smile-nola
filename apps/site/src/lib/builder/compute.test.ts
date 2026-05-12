import { describe, expect, it } from "vitest";
import { computeSubmission } from "./compute";
import type { BuilderSelections } from "./compute";

function sel(partial: Partial<BuilderSelections> = {}): BuilderSelections {
  return {
    collections: [],
    packages: [],
    addons: [],
    ...partial,
  };
}

describe("computeSubmission — Smile basics", () => {
  it("sums Memory Booth + Audio Guest Book", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "memory-booth" }],
        addons:    [{ collectionId: "smile", addonId: "audio-guest-book", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(69500 + 27500); // $970.00
    expect(r.warnings).toEqual([]);
    expect(r.customQuoted).toEqual([]);
  });

  it("multiplies quantities correctly", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "mirror-me" }],
        addons:    [{ collectionId: "smile", addonId: "smile-additional-hour", qty: 3 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(89500 + 15000 * 3);
  });
});

describe("computeSubmission — Aurora minimum warning", () => {
  it("triggers warning when total is below the $2,000 minimum", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        // 39 uplighting fixtures × $50 = $1,950 ($1,999.99 isn't reachable with these prices,
        // so we pick a sub-$2k combo and verify the warning fires).
        addons: [{ collectionId: "aurora", addonId: "uplighting-apelabs", qty: 39 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(5000 * 39);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: "aurora-minimum-not-met" })
    );
  });

  it("does NOT trigger when total >= $2,000", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [{ collectionId: "aurora", addonId: "led-wall-experience", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(300000);
    expect(r.warnings.find((w) => w.code === "aurora-minimum-not-met")).toBeUndefined();
  });

  it("counts spend from OTHER collections toward the Aurora minimum (total scope)", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile", "aurora"],
        // Mirror Me $895 + 23 uplighting × $50 = $895 + $1150 = $2045
        packages: [{ collectionId: "smile",  packageId: "mirror-me" }],
        addons:   [{ collectionId: "aurora", addonId: "uplighting-apelabs", qty: 23 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(89500 + 5000 * 23);
    expect(r.warnings.find((w) => w.code === "aurora-minimum-not-met")).toBeUndefined();
  });
});

describe("computeSubmission — Resonance ceremony exception", () => {
  it("Ceremony Speaker only — no planning-required warning", () => {
    const r = computeSubmission(
      sel({
        collections: ["resonance"],
        addons: [{ collectionId: "resonance", addonId: "ceremony-speaker", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(35000);
    expect(r.warnings.find((w) => w.code === "resonance-planning-required")).toBeUndefined();
  });

  it("Ceremony Speaker + wireless mic — still no planning-required warning", () => {
    const r = computeSubmission(
      sel({
        collections: ["resonance"],
        addons: [
          { collectionId: "resonance", addonId: "ceremony-speaker", qty: 1 },
          { collectionId: "resonance", addonId: "ceremony-wireless-mic", qty: 2 },
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.find((w) => w.code === "resonance-planning-required")).toBeUndefined();
  });

  it("Full Resonance Minimum Spend — triggers planning-conversation warning", () => {
    const r = computeSubmission(
      sel({
        collections: ["resonance"],
        addons: [{ collectionId: "resonance", addonId: "resonance-minimum", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: "resonance-planning-required" })
    );
  });
});

describe("computeSubmission — custom-quoted items", () => {
  it("excludes 'starting at' addons from the subtotal", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [
          { collectionId: "aurora", addonId: "led-wall-experience", qty: 1 },
          { collectionId: "aurora", addonId: "monogram-projection", qty: 1 }, // "starting"
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Starting-priced items contribute their startingPriceCents to the customQuoted list,
    // not to fixedSubtotalCents.
    expect(r.fixedSubtotalCents).toBe(300000);
    expect(r.customQuoted).toContainEqual(
      expect.objectContaining({ addonId: "monogram-projection", startingPriceCents: 50000 })
    );
  });

  it("excludes 'custom' addons from the subtotal", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [
          { collectionId: "aurora", addonId: "led-wall-experience", qty: 1 },
          { collectionId: "aurora", addonId: "power-distribution",  qty: 1 }, // "custom"
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(300000);
    expect(r.customQuoted).toContainEqual(
      expect.objectContaining({ addonId: "power-distribution", startingPriceCents: null })
    );
  });
});

describe("computeSubmission — validation errors", () => {
  it("rejects unknown collection", () => {
    const r = computeSubmission(sel({ collections: ["bogus"] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_collection");
  });

  it("rejects unknown package", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "bogus" }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_selection");
  });

  it("rejects unknown addon", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "memory-booth" }],
        addons:    [{ collectionId: "smile", addonId: "bogus", qty: 1 }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_selection");
  });

  it("rejects qty exceeding qtyMax", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [{ collectionId: "aurora", addonId: "led-wall-expansion", qty: 5 }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("qty_exceeds_max");
  });

  it("rejects qty less than 1", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        addons: [{ collectionId: "smile", addonId: "audio-guest-book", qty: 0 }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid_qty");
  });
});
