/**
 * Server-authoritative recompute of a package builder submission.
 *
 * Pure function: takes the client's selections, walks the canonical catalog,
 * returns the recomputed subtotal, the list of "starting at" / "custom quoted"
 * items, and the array of warnings that should be displayed.
 *
 * Critical: the server NEVER trusts client-supplied totals. This is the source
 * of truth.
 */

import {
  getAddon,
  getCollection,
  getPackage,
  type AddonConfig,
  type CollectionConfig,
  type PackageConfig,
} from "./catalog";

export interface SelectedPackage {
  collectionId: string;
  packageId: string;
}

export interface SelectedAddon {
  collectionId: string;
  addonId: string;
  qty: number;
}

export interface BuilderSelections {
  collections: string[];
  packages: SelectedPackage[];
  addons: SelectedAddon[];
}

export interface CustomQuotedItem {
  collectionId: string;
  addonId: string;
  label: string;
  /** Cents — null for purely-custom items, number for "starting at" items. */
  startingPriceCents: number | null;
}

export type WarningCode =
  | "aurora-minimum-not-met"
  | "resonance-planning-required";

export interface BuilderWarning {
  code: WarningCode;
  message: string;
}

export type ComputeError =
  | "unknown_collection"
  | "unknown_selection"
  | "qty_exceeds_max"
  | "invalid_qty";

export type ComputeResult =
  | {
      ok: true;
      fixedSubtotalCents: number;
      customQuoted: CustomQuotedItem[];
      warnings: BuilderWarning[];
    }
  | {
      ok: false;
      error: ComputeError;
      details?: string;
    };

const AURORA_MIN_WARNING: BuilderWarning = {
  code: "aurora-minimum-not-met",
  message:
    "Aurora requires a $2,000 total Smile NOLA project minimum before lighting or visual production is deployed.",
};

const RESONANCE_PLANNING_WARNING: BuilderWarning = {
  code: "resonance-planning-required",
  message:
    "This Resonance selection requires a planning conversation to finalize pricing.",
};

export function computeSubmission(input: BuilderSelections): ComputeResult {
  // ---- 1. Validate every collection id ----
  const collections: CollectionConfig[] = [];
  for (const id of input.collections) {
    const c = getCollection(id);
    if (!c) {
      return { ok: false, error: "unknown_collection", details: id };
    }
    collections.push(c);
  }
  const selectedCollectionIds = new Set(collections.map((c) => c.id));

  // ---- 2. Validate packages and accumulate fixed cents ----
  let fixedSubtotalCents = 0;

  for (const sp of input.packages) {
    if (!selectedCollectionIds.has(sp.collectionId as CollectionConfig["id"])) {
      return {
        ok: false,
        error: "unknown_selection",
        details: `package ${sp.packageId} belongs to unselected collection ${sp.collectionId}`,
      };
    }
    const pkg: PackageConfig | undefined = getPackage(sp.collectionId, sp.packageId);
    if (!pkg) {
      return { ok: false, error: "unknown_selection", details: `package ${sp.packageId}` };
    }
    fixedSubtotalCents += pkg.priceCents;
  }

  // ---- 3. Validate addons + compute fixed cents + collect custom-quoted ----
  const customQuoted: CustomQuotedItem[] = [];

  for (const sa of input.addons) {
    if (!selectedCollectionIds.has(sa.collectionId as CollectionConfig["id"])) {
      return {
        ok: false,
        error: "unknown_selection",
        details: `addon ${sa.addonId} belongs to unselected collection ${sa.collectionId}`,
      };
    }
    const a: AddonConfig | undefined = getAddon(sa.collectionId, sa.addonId);
    if (!a) {
      return { ok: false, error: "unknown_selection", details: `addon ${sa.addonId}` };
    }
    if (!Number.isInteger(sa.qty) || sa.qty < 1) {
      return { ok: false, error: "invalid_qty", details: `${sa.addonId} qty=${sa.qty}` };
    }
    if (a.qtyMax !== undefined && sa.qty > a.qtyMax) {
      return {
        ok: false,
        error: "qty_exceeds_max",
        details: `${sa.addonId} qty=${sa.qty} max=${a.qtyMax}`,
      };
    }

    if (a.priceType === "fixed") {
      fixedSubtotalCents += (a.priceCents ?? 0) * sa.qty;
    } else {
      // starting | custom — never contributes to fixed subtotal
      customQuoted.push({
        collectionId: sa.collectionId,
        addonId: sa.addonId,
        label: a.name,
        startingPriceCents: a.priceCents, // null for "custom"
      });
    }
  }

  // ---- 4. Warnings ----
  const warnings: BuilderWarning[] = [];

  // Aurora minimum — evaluated against TOTAL fixedSubtotalCents (across all collections)
  if (selectedCollectionIds.has("aurora")) {
    const aurora = getCollection("aurora")!;
    const min = aurora.rules.projectMinimumCents ?? 0;
    if (fixedSubtotalCents < min) {
      warnings.push(AURORA_MIN_WARNING);
    }
  }

  // Resonance planning warning — fires when Resonance is selected AND any addon OTHER than
  // the exception list is selected.
  if (selectedCollectionIds.has("resonance")) {
    const resonance = getCollection("resonance")!;
    const exceptionIds = new Set(resonance.rules.minimumExceptionAddonIds ?? []);
    const hasNonExceptionResonanceAddon = input.addons.some(
      (sa) => sa.collectionId === "resonance" && !exceptionIds.has(sa.addonId),
    );
    if (hasNonExceptionResonanceAddon) {
      warnings.push(RESONANCE_PLANNING_WARNING);
    }
  }

  return { ok: true, fixedSubtotalCents, customQuoted, warnings };
}
