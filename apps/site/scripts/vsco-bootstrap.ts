#!/usr/bin/env -S node --experimental-strip-types
/**
 * VSCO Workspace (Táve) studio bootstrap.
 *
 * One-time / occasional script that brings the studio's lookup tables and
 * custom fields in sync with what the website integration needs.
 *
 * What it does:
 *   1. Reads existing Lead Sources, Lead Statuses, Job Types, Event Types,
 *      Job Roles, Custom Fields, and Brands from the studio.
 *   2. For Job Types: renames any "* Photo Booth" → "*" (drops the suffix
 *      since Smile NOLA now sells five collections, not just photo booth).
 *      Creates any missing types we need.
 *   3. For Lead Sources: creates any we need that don't already exist
 *      (Booth Expo, per-collection website sources). Preserves existing
 *      Facebook, Referral, etc.
 *   4. For Custom Fields: creates the 9 fields the mapping layer needs.
 *   5. For Lead Statuses, Event Types, Job Roles: matches by name. Does
 *      NOT create. (Studio already has well-designed sets we reuse.)
 *   6. Records the resolved IDs (existing + newly-created) into
 *      `apps/site/vsco-config.json` (gitignored). The push layer reads
 *      this at runtime.
 *
 * Usage:
 *   pnpm vsco:bootstrap:dry      # preview, no writes
 *   pnpm vsco:bootstrap          # apply, write vsco-config.json
 *
 * Re-running is safe — every step is idempotent. Already-correct entries
 * are skipped with "OK".
 *
 * Notes on the studio's existing state (as of Smile NOLA's studio):
 *  - 10 Job Types, all suffixed "Photo Booth" — script renames in place.
 *  - 14 Lead Statuses, well-designed (New / Initial Contact / Needs
 *    Follow Up / Sent Quote / Follow Up: 1/2/3 Weeks / etc.) — reused as is.
 *  - 19 Job Roles including BOTH Bride/Groom AND Partner A/Partner B —
 *    we map to Partner A/Partner B by default (inclusive).
 *  - 10 Event Types — we reuse existing matches (Consultation, Wedding
 *    Ceremony, Wedding Reception, Main Event).
 *  - 0 Custom Fields — clean slate; all 9 fields will be created.
 *  - 0 Tax Groups — must be configured manually in the Workspace UI
 *    before invoices can apply tax. Script warns but does not block.
 *
 * Behavior in case of an "already exists" race: if a POST fails with a
 * duplicate-name error, the script re-fetches and reuses the existing ID.
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VscoClient, VscoError } from '../src/lib/vsco/client.ts';
import type {
  Collection,
  CustomField,
  CustomFieldCreate,
  EventType,
  JobRole,
  JobType,
  LeadSource,
  LeadStatus,
} from '../src/lib/vsco/types.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(SCRIPT_DIR, '..');

const CONFIG_PATH = resolve(SITE_DIR, 'vsco-config.json');
const CONFIG_PATH_TMP = `${CONFIG_PATH}.tmp`;

/* ============================================================================
 * Desired-state declarations
 *
 * Each "DESIRED_*" block describes what we want to exist in the studio.
 * The script reconciles existing → desired with the smallest possible
 * changes (rename or create, never delete).
 * ========================================================================= */

interface DesiredLeadSource {
  key: string;
  name: string;
  /** When present, the script will create only if no entry with this name
   *  AND no entry from `aliases` already exists. Lets us reuse "Referral
   *  from Friend or Family" as our "referral" key. */
  aliases?: string[];
}

const DESIRED_LEAD_SOURCES: DesiredLeadSource[] = [
  { key: 'website-contact', name: 'Website — Contact Form' },
  { key: 'website-collection-smile', name: 'Website — Smile Collection' },
  { key: 'website-collection-visionary', name: 'Website — Visionary Suite' },
  { key: 'website-collection-digital-atelier', name: 'Website — Digital Atelier' },
  { key: 'website-collection-aurora', name: 'Website — Aurora Collection' },
  { key: 'website-collection-resonance', name: 'Website — Resonance Series' },
  { key: 'booth-expo', name: 'Booth — Expo' },
  // Reuse existing "Referral from Friend or Family" if present; otherwise create "Referral".
  { key: 'referral', name: 'Referral', aliases: ['Referral from Friend or Family'] },
  // Reuse existing "Other" if present.
  { key: 'other', name: 'Other' },
];

/**
 * Job Types (Model B): one per service line. Each pairs with its own
 * Workflow which gets auto-attached when a Job of that type is created.
 *
 * The studio owner creates these three Job Types + Workflows in the VSCO
 * UI (Settings → Lists → Job Types, Settings → Workflows). The bootstrap
 * script then matches by name to auto-discover the ULIDs.
 *
 * Routing priority (in inquiryToJobWorksheet — see mappings.ts):
 *   1. Inquiry interested in 'visionary' (videography)      → Videography
 *   2. Else inquiry interested in 'smile' (photo booth)     → Photo Booth
 *   3. Else                                                   → Production
 *      (Aurora-only, Digital-Atelier-only, Resonance-only,
 *       multi-non-priority, or nothing checked)
 *
 * The 13 event-type-named Job Types from the original bootstrap (Wedding,
 * Anniversary, Bar/Bat Mitzvah, etc.) are intentionally NOT reconciled
 * here. They stay attached to historical client jobs and remain available
 * in the UI dropdown for any manually-created records. New website /
 * booth inquiries route through one of the 3 service Job Types below.
 */
const DESIRED_JOB_TYPE_NAMES: Readonly<Record<string, string>> = {
  'photo-booth': 'Photo Booth',
  'videography': 'Videography',
  'production':  'Production',
} as const;

/**
 * Workflows are discovered automatically: for each Job Type above, we
 * read its `workflowId` and record it under the same key. No UI list
 * matching needed — the relationship is intrinsic to the Job Type.
 *
 * If any Job Type has a NULL workflowId, the corresponding workflow key
 * gets recorded as null in the config; the mapping layer falls back to
 * the Job Type's default at create time (which will be null too — fine,
 * just means no workflow attaches).
 */

/**
 * Lead Statuses, Event Types, and Job Roles are MATCH-ONLY: we look up by
 * name and record the ID. We never create or rename them — your studio
 * already has well-curated sets we want to honor.
 */
const MATCH_LEAD_STATUSES = {
  // Keys our mapping layer uses → display name in the studio.
  'new':              'New',
  'contacted':        'Initial Contact',
  'follow-up':        'Needs Follow Up',
  'meeting-scheduled': 'Meeting Scheduled',
  'sent-quote':       'Sent Quote',
  'waiting-on-customer': 'Waiting on Customer',
  'stale':            'Stale',
} as const;

const MATCH_EVENT_TYPES = {
  'ceremony':     'Wedding Ceremony',
  'reception':    'Wedding Reception',
  'main-event':   'Main Event',
  'consultation': 'Consultation',
  'walkthrough':  'Venue Walkthrough',
  'setup':        'Setup',
  'meeting':      'Meeting',
  'call':         'Call',
} as const;

const MATCH_JOB_ROLES = {
  'partner-a':         'Partner A',
  'partner-b':         'Partner B',
  'planner':           'Planner',
  'primary-contact':   'Primary Contact',
  'secondary-contact': 'Secondary Contact',
  'organizer-client':  'Organizer (client)',
  'venue':             'Venue',
  'parent-a':          'Parent A',
  'parent-b':          'Parent B',
  'organization':      'Organization',
  'main-subject':      'Main Subject',
} as const;

interface DesiredCustomField {
  key: string;
  spec: CustomFieldCreate;
}

const DESIRED_CUSTOM_FIELDS: DesiredCustomField[] = [
  { key: 'interested-smile',           spec: { canApplyTo: 'Job', kind: 'Checkbox', name: 'Interested: Smile Booth' } },
  { key: 'interested-visionary',       spec: { canApplyTo: 'Job', kind: 'Checkbox', name: 'Interested: Visionary Video' } },
  { key: 'interested-digital-atelier', spec: { canApplyTo: 'Job', kind: 'Checkbox', name: 'Interested: Digital Atelier' } },
  { key: 'interested-aurora',          spec: { canApplyTo: 'Job', kind: 'Checkbox', name: 'Interested: Aurora Lighting' } },
  { key: 'interested-resonance',       spec: { canApplyTo: 'Job', kind: 'Checkbox', name: 'Interested: Resonance Sound' } },
  { key: 'reserved-package',           spec: { canApplyTo: 'Job', kind: 'DropDown', name: 'Reserved Package',
    choices: ['Memory Booth', 'Mirror Me Experience', 'Mirror Me All Night'] } },
  { key: 'event-setting',              spec: { canApplyTo: 'Job', kind: 'DropDown', name: 'Event Setting',
    choices: ['Indoor', 'Outdoor — Covered', 'Outdoor — Uncovered', 'Not sure yet'] } },
  { key: 'consultation-preference',    spec: { canApplyTo: 'Job', kind: 'DropDown', name: 'Consultation Preference',
    choices: ['Video', 'In-Person', 'None'] } },
  { key: 'builder-submission-link',    spec: { canApplyTo: 'Job', kind: 'TextField', name: 'Builder Submission Link' } },
  /* Event occasion — now that Job Type carries the service line (Photo Booth /
     Videography / Production), we need a separate field to capture WHAT KIND
     OF EVENT the booking is (Wedding / Reception / Corporate / etc.). The
     mapping layer reads inquiry.event_type and writes it here. */
  { key: 'event-occasion',             spec: { canApplyTo: 'Job', kind: 'DropDown', name: 'Event Occasion',
    choices: [
      'Wedding',
      'Reception',
      'Engagement / Rehearsal',
      'Corporate Event',
      'Gala',
      'Milestone Celebration',
      'Anniversary',
      'Birthday',
      'Bar / Bat Mitzvah',
      'Charity Event',
      'Graduation',
      'Holiday Party',
      'Other Event',
    ] } },
];

/* ============================================================================
 * Config shape (what we write to vsco-config.json)
 *
 * Mirrors the keys above. Every leaf is either a ULID string or null
 * (during the script run) — once we write, every leaf should be a real ID
 * or the script throws.
 * ========================================================================= */

interface ConfigShape {
  generatedAt: string;
  studioBrandId: string | null;
  leadSources: Record<string, string | null>;
  leadStatuses: Record<string, string | null>;
  jobTypes: Record<string, string | null>;
  /** Workflow ULIDs auto-discovered from JobType.workflowId. Keys mirror jobTypes. */
  workflows: Record<string, string | null>;
  eventTypes: Record<string, string | null>;
  jobRoles: Record<string, string | null>;
  customFields: Record<string, string | null>;
}

/* ============================================================================
 * CLI argument parsing
 * ========================================================================= */

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

if (args.some((a) => a === '--help' || a === '-h')) {
  console.log(
    [
      'Usage: pnpm vsco:bootstrap [--dry-run]',
      '',
      '  --dry-run    Show what would be created/renamed without writing.',
      '',
      'Requires env vars: VSCO_API_KEY, VSCO_API_BASE.',
      'Reads from apps/site/.env (loaded by the npm script).',
    ].join('\n'),
  );
  process.exit(0);
}

/* ============================================================================
 * .env loader
 *
 * The npm script doesn't auto-load .env, so we do it ourselves. We're very
 * conservative: only `KEY=value` lines, no shell escapes, no variable
 * interpolation. Keys already in process.env are preserved (caller wins).
 * ========================================================================= */

function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(SITE_DIR, '.env'));

const VSCO_API_KEY = process.env.VSCO_API_KEY;
const VSCO_API_BASE = process.env.VSCO_API_BASE ?? 'https://workspace.vsco.co/api/v2';

if (!VSCO_API_KEY) {
  console.error('ERROR: VSCO_API_KEY is not set. Add it to apps/site/.env.');
  process.exit(2);
}

/* ============================================================================
 * Tiny terminal helpers
 * ========================================================================= */

const C_RESET = '\x1b[0m';
const C_DIM = '\x1b[2m';
const C_BOLD = '\x1b[1m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_RED = '\x1b[31m';
const C_BLUE = '\x1b[34m';

function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function header(title: string): void {
  console.log('');
  console.log(`${C_BOLD}${C_BLUE}── ${title} ──${C_RESET}`);
}

function log(status: 'OK' | 'CREATE' | 'RENAME' | 'SKIP' | 'WARN' | 'MISS', key: string, detail: string): void {
  const color =
    status === 'OK'     ? C_GREEN  :
    status === 'CREATE' ? C_BLUE   :
    status === 'RENAME' ? C_BLUE   :
    status === 'SKIP'   ? C_DIM    :
    status === 'WARN'   ? C_YELLOW :
    /* MISS */            C_RED;
  console.log(`  ${color}${pad(status, 7)}${C_RESET} ${pad(key, 36)} ${C_DIM}${detail}${C_RESET}`);
}

/* ============================================================================
 * Pagination helper
 *
 * Walks all pages of a list endpoint. The API tops out at pageSize=100.
 * ========================================================================= */

async function listAll<T>(client: VscoClient, path: string, includeHidden = false): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}pageSize=100&page=${page}` + (includeHidden ? '&includeHidden=true' : '');
    const res = await client.get<Collection<T>>(url);
    out.push(...res.items);
    if (page >= res.meta.totalPages) break;
    page++;
  }
  return out;
}

/* ============================================================================
 * Reconcilers — one per entity category
 * ========================================================================= */

async function reconcileLeadSources(
  client: VscoClient,
  cfg: ConfigShape,
): Promise<void> {
  header('Lead Sources');
  const existing = await listAll<LeadSource>(client, '/lead-source');
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));

  for (const desired of DESIRED_LEAD_SOURCES) {
    // Try the canonical name first, then aliases.
    const candidates = [desired.name, ...(desired.aliases ?? [])];
    const found = candidates
      .map((n) => byName.get(n.toLowerCase()))
      .find((x): x is LeadSource => Boolean(x));

    if (found) {
      cfg.leadSources[desired.key] = found.id;
      const detail = found.name === desired.name ? found.id : `reuses "${found.name}" (${found.id})`;
      log('OK', desired.key, detail);
      continue;
    }

    if (DRY_RUN) {
      log('CREATE', desired.key, `(dry-run) would create "${desired.name}"`);
      continue;
    }

    try {
      const created = await client.post<LeadSource>('/lead-source', { name: desired.name });
      cfg.leadSources[desired.key] = created.id;
      log('CREATE', desired.key, `${created.id}  "${desired.name}"`);
    } catch (err) {
      handleCreateError('lead-source', desired.key, err);
    }
  }
}

/**
 * Match-only: the 3 service Job Types must already exist in the studio
 * (the owner creates them in the VSCO UI alongside their workflows).
 * We never auto-create here because we need the workflow attachment to
 * be done by the human in the UI; auto-creating a Job Type with no
 * workflow would leave new inquiries with no automation.
 *
 * After matching, we also auto-discover the workflow ULID from each
 * Job Type's `workflowId` field and populate cfg.workflows[key].
 */
async function reconcileJobTypes(
  client: VscoClient,
  cfg: ConfigShape,
): Promise<void> {
  header('Job Types (service-typed, match-only)');
  const existing = await listAll<JobType>(client, '/job-type');
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));

  for (const [key, desiredName] of Object.entries(DESIRED_JOB_TYPE_NAMES)) {
    const found = byName.get(desiredName.toLowerCase());
    if (found) {
      cfg.jobTypes[key] = found.id;
      log('OK', key, `${found.id}  "${found.name}"`);

      // Auto-discover workflow ULID
      // The JobType type doesn't declare workflowId in our types.ts, but
      // the live API returns it. Cast through unknown to read it.
      const wfId = (found as unknown as { workflowId?: string | null }).workflowId ?? null;
      cfg.workflows[key] = wfId;
      if (wfId) {
        log('OK', `${key}.workflow`, wfId);
      } else {
        log('WARN', `${key}.workflow`, 'no workflow attached to this Job Type — attach one in Workspace UI');
      }
    } else {
      cfg.jobTypes[key] = null;
      cfg.workflows[key] = null;
      log('MISS', key, `no Job Type named "${desiredName}" — create it in Workspace UI with the appropriate workflow attached`);
    }
  }
}

async function matchLookups<T extends { id: string; name: string }>(
  label: string,
  client: VscoClient,
  path: string,
  desired: Readonly<Record<string, string>>,
  cfgTarget: Record<string, string | null>,
): Promise<void> {
  header(label);
  const existing = await listAll<T>(client, path);
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));

  for (const [key, desiredName] of Object.entries(desired)) {
    const found = byName.get(desiredName.toLowerCase());
    if (found) {
      cfgTarget[key] = found.id;
      log('OK', key, `${found.id}  "${found.name}"`);
    } else {
      log('MISS', key, `no entry named "${desiredName}" — set it up in Workspace UI`);
    }
  }
}

async function reconcileCustomFields(
  client: VscoClient,
  cfg: ConfigShape,
): Promise<void> {
  header('Custom Fields');
  const existing = await listAll<CustomField>(client, '/custom-field', /* includeHidden */ true);
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));

  for (const desired of DESIRED_CUSTOM_FIELDS) {
    const found = byName.get(desired.spec.name.toLowerCase());
    if (found) {
      if (found.hidden) {
        log('WARN', desired.key, `${found.id}  exists but is HIDDEN — un-hide in Workspace UI`);
      } else {
        log('OK', desired.key, `${found.id}  ${found.kind}`);
      }
      cfg.customFields[desired.key] = found.id;
      continue;
    }

    if (DRY_RUN) {
      log('CREATE', desired.key, `(dry-run) would create ${desired.spec.kind} "${desired.spec.name}"`);
      continue;
    }

    try {
      const created = await client.post<CustomField>('/custom-field', desired.spec);
      cfg.customFields[desired.key] = created.id;
      log('CREATE', desired.key, `${created.id}  ${created.kind} "${created.name}"`);
    } catch (err) {
      handleCreateError('custom-field', desired.key, err);
    }
  }
}

async function recordStudioBrand(client: VscoClient, cfg: ConfigShape): Promise<void> {
  header('Brand');
  const brands = await listAll<{ id: string; name: string }>(client, '/brand');
  if (brands.length === 0) {
    log('WARN', 'studioBrand', 'no Brand configured — create one in Workspace UI');
    return;
  }
  // Prefer "Smile NOLA" by name; fall back to the first brand.
  const preferred = brands.find((b) => b.name.toLowerCase().includes('smile')) ?? brands[0];
  cfg.studioBrandId = preferred.id;
  log('OK', 'studioBrand', `${preferred.id}  "${preferred.name}"`);
}

async function checkTaxGroups(client: VscoClient): Promise<void> {
  header('Tax Groups (informational)');
  const groups = await listAll<{ id: string; name: string }>(client, '/tax-group');
  if (groups.length === 0) {
    log('WARN', 'taxGroups', 'no Tax Group configured — invoices will have no tax until you create one in Workspace');
  } else {
    for (const g of groups) log('OK', g.name, g.id);
  }
}

/* ============================================================================
 * Error handler — convert VscoError into a useful console line and exit code
 * ========================================================================= */

let SAW_FATAL = false;

function handleCreateError(entity: string, key: string, err: unknown): void {
  SAW_FATAL = true;
  if (err instanceof VscoError) {
    const detail = err.body?.detail ?? err.body?.title ?? err.message;
    log('MISS', key, `[HTTP ${err.status}] ${entity}: ${detail}`);
  } else {
    log('MISS', key, `${entity}: ${String((err as Error)?.message ?? err)}`);
  }
}

/* ============================================================================
 * Main
 * ========================================================================= */

async function main(): Promise<void> {
  console.log(`${C_BOLD}VSCO Workspace bootstrap${C_RESET}`);
  console.log(`  base:    ${VSCO_API_BASE}`);
  console.log(`  config:  ${CONFIG_PATH}`);
  console.log(`  mode:    ${DRY_RUN ? `${C_YELLOW}DRY-RUN${C_RESET} (no writes)` : `${C_GREEN}APPLY${C_RESET}`}`);

  const client = new VscoClient({
    apiKey: VSCO_API_KEY!,
    baseUrl: VSCO_API_BASE,
  });

  const cfg: ConfigShape = {
    generatedAt: new Date().toISOString(),
    studioBrandId: null,
    leadSources: Object.fromEntries(DESIRED_LEAD_SOURCES.map((d) => [d.key, null])),
    leadStatuses: Object.fromEntries(Object.keys(MATCH_LEAD_STATUSES).map((k) => [k, null])),
    jobTypes: Object.fromEntries(Object.keys(DESIRED_JOB_TYPE_NAMES).map((k) => [k, null])),
    workflows: Object.fromEntries(Object.keys(DESIRED_JOB_TYPE_NAMES).map((k) => [k, null])),
    eventTypes: Object.fromEntries(Object.keys(MATCH_EVENT_TYPES).map((k) => [k, null])),
    jobRoles: Object.fromEntries(Object.keys(MATCH_JOB_ROLES).map((k) => [k, null])),
    customFields: Object.fromEntries(DESIRED_CUSTOM_FIELDS.map((d) => [d.key, null])),
  };

  try {
    await recordStudioBrand(client, cfg);
    await reconcileLeadSources(client, cfg);
    await matchLookups<LeadStatus>('Lead Statuses (match-only)', client, '/lead-status', MATCH_LEAD_STATUSES, cfg.leadStatuses);
    await reconcileJobTypes(client, cfg);
    await matchLookups<EventType>('Event Types (match-only)', client, '/event-type', MATCH_EVENT_TYPES, cfg.eventTypes);
    await matchLookups<JobRole>('Job Roles (match-only)', client, '/job-role', MATCH_JOB_ROLES, cfg.jobRoles);
    await reconcileCustomFields(client, cfg);
    await checkTaxGroups(client);
  } catch (err) {
    if (err instanceof VscoError) {
      console.error(`\n${C_RED}FATAL VscoError [${err.status}]:${C_RESET} ${err.message}`);
      if (err.body) console.error(JSON.stringify(err.body, null, 2));
    } else {
      console.error(`\n${C_RED}FATAL:${C_RESET}`, err);
    }
    process.exit(3);
  }

  // Summary
  const missing = countMissing(cfg);
  console.log('');
  console.log(`${C_BOLD}Summary${C_RESET}`);
  console.log(`  brand:         ${cfg.studioBrandId ? 'OK' : 'MISSING'}`);
  console.log(`  lead sources:  ${countResolved(cfg.leadSources)} / ${Object.keys(cfg.leadSources).length}`);
  console.log(`  lead statuses: ${countResolved(cfg.leadStatuses)} / ${Object.keys(cfg.leadStatuses).length}`);
  console.log(`  job types:     ${countResolved(cfg.jobTypes)} / ${Object.keys(cfg.jobTypes).length}`);
  console.log(`  workflows:     ${countResolved(cfg.workflows)} / ${Object.keys(cfg.workflows).length}`);
  console.log(`  event types:   ${countResolved(cfg.eventTypes)} / ${Object.keys(cfg.eventTypes).length}`);
  console.log(`  job roles:     ${countResolved(cfg.jobRoles)} / ${Object.keys(cfg.jobRoles).length}`);
  console.log(`  custom fields: ${countResolved(cfg.customFields)} / ${Object.keys(cfg.customFields).length}`);
  if (missing > 0) {
    console.log(`\n${C_YELLOW}Notice:${C_RESET} ${missing} entry${missing === 1 ? '' : 'ies'} unresolved.`);
  }

  if (DRY_RUN) {
    console.log(`\n${C_YELLOW}Dry-run complete — no changes made. Run without --dry-run to apply.${C_RESET}`);
    return;
  }

  // Write config atomically.
  writeFileSync(CONFIG_PATH_TMP, JSON.stringify(cfg, null, 2));
  renameSync(CONFIG_PATH_TMP, CONFIG_PATH);

  console.log(`\n${C_GREEN}Wrote ${CONFIG_PATH}${C_RESET}`);
  console.log(`Set ${C_BOLD}VSCO_ENABLED=1${C_RESET} in apps/site/.env to start pushing data.`);

  if (SAW_FATAL) process.exit(1);
}

function countResolved(o: Record<string, string | null>): number {
  return Object.values(o).filter((v) => v !== null).length;
}

function countMissing(cfg: ConfigShape): number {
  let n = 0;
  if (!cfg.studioBrandId) n++;
  for (const r of [cfg.leadSources, cfg.leadStatuses, cfg.jobTypes, cfg.workflows, cfg.eventTypes, cfg.jobRoles, cfg.customFields]) {
    n += Object.values(r).filter((v) => v === null).length;
  }
  return n;
}

main().catch((err) => {
  console.error(`${C_RED}Unhandled:${C_RESET}`, err);
  process.exit(99);
});
