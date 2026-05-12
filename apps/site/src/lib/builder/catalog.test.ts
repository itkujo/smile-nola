import { describe, expect, it } from "vitest";
import { COLLECTIONS, getAddon, getCollection, getPackage } from "./catalog";

describe("catalog invariants", () => {
  it("has all five collections", () => {
    const ids = COLLECTIONS.map((c) => c.id).sort();
    expect(ids).toEqual(["aurora", "digital-atelier", "resonance", "smile", "visionary"]);
  });

  it("has no duplicate package ids within a collection", () => {
    for (const c of COLLECTIONS) {
      const ids = c.packages.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("has no duplicate addon ids within a collection", () => {
    for (const c of COLLECTIONS) {
      const ids = c.addons.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("packages all have positive integer cent prices", () => {
    for (const c of COLLECTIONS) {
      for (const p of c.packages) {
        expect(Number.isInteger(p.priceCents)).toBe(true);
        expect(p.priceCents).toBeGreaterThan(0);
      }
    }
  });

  it("fixed addons have a positive priceCents; custom addons have null", () => {
    for (const c of COLLECTIONS) {
      for (const a of c.addons) {
        if (a.priceType === "custom") {
          expect(a.priceCents).toBeNull();
        } else {
          expect(a.priceCents).not.toBeNull();
          expect(Number.isInteger(a.priceCents)).toBe(true);
          expect(a.priceCents).toBeGreaterThan(0);
        }
      }
    }
  });

  it("Aurora has a $2,000 project minimum", () => {
    const aurora = getCollection("aurora");
    expect(aurora?.rules.projectMinimumCents).toBe(200000);
  });

  it("Resonance ceremony speaker is the minimum exception", () => {
    const res = getCollection("resonance");
    expect(res?.rules.minimumExceptionAddonIds).toContain("ceremony-speaker");
  });

  it("LED wall expansion is qty-capped at 4", () => {
    const exp = getAddon("aurora", "led-wall-expansion");
    expect(exp?.qty).toBe(true);
    expect(exp?.qtyMax).toBe(4);
  });

  it("getPackage / getAddon return undefined for unknown ids", () => {
    expect(getPackage("smile", "nonexistent")).toBeUndefined();
    expect(getAddon("aurora", "nonexistent")).toBeUndefined();
    expect(getCollection("nonexistent")).toBeUndefined();
  });
});
