/**
 * VSCO Workspace config loader.
 *
 * Reads the generated `apps/site/vsco-config.json` (produced by
 * `scripts/vsco-bootstrap.ts`) and exposes the resolved studio IDs.
 *
 * This file is the one place in the codebase that knows the file path
 * and shape of the config. The rest of the integration imports typed
 * getters from here.
 *
 * The config is cached per-process. Call `resetVscoConfigCache()` in tests.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ──────────────────────────────────────────────────────────────────────
// Key sets (must match exactly what the bootstrap script writes)
// ──────────────────────────────────────────────────────────────────────

export const LEAD_SOURCE_KEYS = [
  'website-contact',
  'website-collection-smile',
  'website-collection-visionary',
  'website-collection-digital-atelier',
  'website-collection-aurora',
  'website-collection-resonance',
  'booth-expo',
  'referral',
  'other',
] as const
export type LeadSourceKey = (typeof LEAD_SOURCE_KEYS)[number]

export const LEAD_STATUS_KEYS = [
  'new',
  'contacted',
  'follow-up',
  'meeting-scheduled',
  'sent-quote',
  'waiting-on-customer',
  'stale',
] as const
export type LeadStatusKey = (typeof LEAD_STATUS_KEYS)[number]

export const JOB_TYPE_KEYS = [
  'wedding',
  'reception',
  'engagement-rehearsal',
  'corporate',
  'gala',
  'milestone',
  'anniversary',
  'birthday',
  'bar-bat-mitzvah',
  'charity',
  'graduation',
  'holiday',
  'other',
] as const
export type JobTypeKey = (typeof JOB_TYPE_KEYS)[number]

export const EVENT_TYPE_KEYS = [
  'ceremony',
  'reception',
  'main-event',
  'consultation',
  'walkthrough',
  'setup',
  'meeting',
  'call',
] as const
export type EventTypeKey = (typeof EVENT_TYPE_KEYS)[number]

export const JOB_ROLE_KEYS = [
  'partner-a',
  'partner-b',
  'planner',
  'primary-contact',
  'secondary-contact',
  'organizer-client',
  'venue',
  'parent-a',
  'parent-b',
  'organization',
  'main-subject',
] as const
export type JobRoleKey = (typeof JOB_ROLE_KEYS)[number]

export const CUSTOM_FIELD_KEYS = [
  'interested-smile',
  'interested-visionary',
  'interested-digital-atelier',
  'interested-aurora',
  'interested-resonance',
  'reserved-package',
  'event-setting',
  'consultation-preference',
  'builder-submission-link',
] as const
export type CustomFieldKey = (typeof CUSTOM_FIELD_KEYS)[number]

// ──────────────────────────────────────────────────────────────────────
// Config shape
// ──────────────────────────────────────────────────────────────────────

export interface VscoConfig {
  generatedAt: string
  studioBrandId: string
  leadSources: Record<LeadSourceKey, string>
  leadStatuses: Record<LeadStatusKey, string>
  jobTypes: Record<JobTypeKey, string>
  eventTypes: Record<EventTypeKey, string>
  jobRoles: Record<JobRoleKey, string>
  customFields: Record<CustomFieldKey, string>
}

// ──────────────────────────────────────────────────────────────────────
// Loader
// ──────────────────────────────────────────────────────────────────────

let cached: VscoConfig | null = null
let cachedPath: string | null = null

export function resetVscoConfigCache(): void {
  cached = null
  cachedPath = null
}

export interface LoadVscoConfigOptions {
  /** Override the default path (mainly for tests). */
  path?: string
}

/**
 * Default config path: `apps/site/vsco-config.json` relative to the
 * current working directory. In production this is the site app's
 * working dir; in tests the path is explicit.
 */
function defaultConfigPath(): string {
  // The site app starts with cwd = apps/site, so a plain filename works.
  // We also accept an override via env (handy for CI / Docker).
  return process.env.VSCO_CONFIG_PATH || join(process.cwd(), 'vsco-config.json')
}

export function loadVscoConfig(options: LoadVscoConfigOptions = {}): VscoConfig {
  const path = options.path || defaultConfigPath()
  if (cached && cachedPath === path) return cached

  if (!existsSync(path)) {
    throw new Error(
      `vsco-config.json not found at ${path}. Run \`pnpm vsco:bootstrap\` to generate it.`,
    )
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`Failed to read vsco-config.json at ${path}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse vsco-config.json at ${path}: ${(err as Error).message}`)
  }

  const cfg = validate(parsed, path)
  cached = cfg
  cachedPath = path
  return cfg
}

function validate(parsed: unknown, path: string): VscoConfig {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`vsco-config.json at ${path} must be a JSON object`)
  }
  const obj = parsed as Record<string, unknown>

  const studioBrandId = obj.studioBrandId
  if (typeof studioBrandId !== 'string' || studioBrandId.length === 0) {
    throw new Error(`vsco-config.json missing required studioBrandId`)
  }

  const generatedAt = typeof obj.generatedAt === 'string' ? obj.generatedAt : ''

  const leadSources = requireKeyedRecord(
    obj.leadSources,
    'leadSources',
    LEAD_SOURCE_KEYS,
  )
  const leadStatuses = requireKeyedRecord(
    obj.leadStatuses,
    'leadStatuses',
    LEAD_STATUS_KEYS,
  )
  const jobTypes = requireKeyedRecord(obj.jobTypes, 'jobTypes', JOB_TYPE_KEYS)
  const eventTypes = requireKeyedRecord(
    obj.eventTypes,
    'eventTypes',
    EVENT_TYPE_KEYS,
  )
  const jobRoles = requireKeyedRecord(obj.jobRoles, 'jobRoles', JOB_ROLE_KEYS)
  const customFields = requireKeyedRecord(
    obj.customFields,
    'customFields',
    CUSTOM_FIELD_KEYS,
  )

  return {
    generatedAt,
    studioBrandId,
    leadSources,
    leadStatuses,
    jobTypes,
    eventTypes,
    jobRoles,
    customFields,
  }
}

function requireKeyedRecord<K extends string>(
  value: unknown,
  parentKey: string,
  keys: readonly K[],
): Record<K, string> {
  if (!value || typeof value !== 'object') {
    throw new Error(`vsco-config.json missing required object: ${parentKey}`)
  }
  const obj = value as Record<string, unknown>
  const result = {} as Record<K, string>
  for (const k of keys) {
    const v = obj[k]
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(
        `vsco-config.json missing required ID at ${parentKey}.${k}`,
      )
    }
    result[k] = v
  }
  return result
}

// ──────────────────────────────────────────────────────────────────────
// Typed convenience getters (used by mapping/push layers)
// ──────────────────────────────────────────────────────────────────────

export function leadSourceId(cfg: VscoConfig, key: LeadSourceKey): string {
  return cfg.leadSources[key]
}
export function leadStatusId(cfg: VscoConfig, key: LeadStatusKey): string {
  return cfg.leadStatuses[key]
}
export function jobTypeId(cfg: VscoConfig, key: JobTypeKey): string {
  return cfg.jobTypes[key]
}
export function eventTypeId(cfg: VscoConfig, key: EventTypeKey): string {
  return cfg.eventTypes[key]
}
export function jobRoleId(cfg: VscoConfig, key: JobRoleKey): string {
  return cfg.jobRoles[key]
}
export function customFieldId(cfg: VscoConfig, key: CustomFieldKey): string {
  return cfg.customFields[key]
}
