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

/**
 * Soft warnings surfaced under the investment rail. Each is a guard-rail,
 * not a blocker — submission still succeeds; daniel sees the warnings on
 * the ops side and resolves them in the consultation.
 *
 * `project-minimum-not-met` — fires when a collection with a project-wide
 *   minimum spend rule (currently Aurora and Resonance) is selected and
 *   the total fixed subtotal across ALL collections is below that floor.
 *   Resonance has an exception: addons listed in `minimumExceptionAddonIds`
 *   (ceremony-speaker, ceremony-wireless-mic) may be ordered standalone
 *   without triggering the warning, provided no Resonance package is
 *   selected.
 */
export type WarningCode = "project-minimum-not-met";

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

const PROJECT_MINIMUM_WARNING: BuilderWarning = {
  code: "project-minimum-not-met",
  message:
    "This selection requires a $2,000 total Smile NOLA project minimum. Add a package from another collection, or expand this one, to clear the floor.",
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

  // Project-minimum check — fires when any selected collection declares a
  // `projectMinimumCents` rule and the project-wide fixedSubtotalCents is
  // below that floor. Currently applies to Aurora and Resonance.
  //
  // Per-collection exception logic: Resonance allows certain addons
  // (ceremony-speaker / wireless mic) to be ordered standalone without
  // triggering the minimum, provided no Resonance package is selected.
  // If a Resonance package IS selected, the floor applies regardless.
  let minimumTriggered = false;
  for (const c of collections) {
    const min = c.rules.projectMinimumCents;
    if (!min) continue;
    if (fixedSubtotalCents >= min) continue;

    const exceptionIds = new Set(c.rules.minimumExceptionAddonIds ?? []);
    if (exceptionIds.size > 0) {
      const hasPackageInThisCollection = input.packages.some(
        (sp) => sp.collectionId === c.id,
      );
      const collectionAddons = input.addons.filter(
        (sa) => sa.collectionId === c.id,
      );
      const allAddonsAreExceptions =
        collectionAddons.length > 0 &&
        collectionAddons.every((sa) => exceptionIds.has(sa.addonId));

      // Pure exception-only state: no package + only exception addons →
      // waive the minimum for this collection.
      if (!hasPackageInThisCollection && allAddonsAreExceptions) {
        continue;
      }
    }

    minimumTriggered = true;
    break;
  }
  if (minimumTriggered) {
    warnings.push(PROJECT_MINIMUM_WARNING);
  }

  return { ok: true, fixedSubtotalCents, customQuoted, warnings };
}
