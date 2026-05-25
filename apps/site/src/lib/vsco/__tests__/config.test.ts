import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadVscoConfig,
  resetVscoConfigCache,
  type VscoConfig,
} from '../config.ts'

const validConfig: VscoConfig = {
  generatedAt: '2026-05-13T04:00:00.000Z',
  studioBrandId: '01brand0000000000000000000',
  leadSources: {
    'website-contact': '01ls0001',
    'website-collection-smile': '01ls0002',
    'website-collection-visionary': '01ls0003',
    'website-collection-digital-atelier': '01ls0004',
    'website-collection-aurora': '01ls0005',
    'website-collection-resonance': '01ls0006',
    'booth-expo': '01ls0007',
    referral: '01ls0008',
    other: '01ls0009',
  },
  leadStatuses: {
    new: '01st0001',
    contacted: '01st0002',
    'follow-up': '01st0003',
    'meeting-scheduled': '01st0004',
    'sent-quote': '01st0005',
    'waiting-on-customer': '01st0006',
    stale: '01st0007',
  },
  jobTypes: {
    'photo-booth': '01jt0001',
    videography: '01jt0002',
    production: '01jt0003',
  },
  workflows: {
    'photo-booth': '01wf0001',
    videography: '01wf0002',
    production: '01wf0003',
  },
  eventTypes: {
    ceremony: '01et0001',
    reception: '01et0002',
    'main-event': '01et0003',
    consultation: '01et0004',
    walkthrough: '01et0005',
    setup: '01et0006',
    meeting: '01et0007',
    call: '01et0008',
  },
  jobRoles: {
    'partner-a': '01jr0001',
    'partner-b': '01jr0002',
    planner: '01jr0003',
    'primary-contact': '01jr0004',
    'secondary-contact': '01jr0005',
    'organizer-client': '01jr0006',
    venue: '01jr0007',
    'parent-a': '01jr0008',
    'parent-b': '01jr0009',
    organization: '01jr0010',
    'main-subject': '01jr0011',
  },
  customFields: {
    'interested-smile': '01cf0001',
    'interested-visionary': '01cf0002',
    'interested-digital-atelier': '01cf0003',
    'interested-aurora': '01cf0004',
    'interested-resonance': '01cf0005',
    'reserved-package': '01cf0006',
    'event-setting': '01cf0007',
    'consultation-preference': '01cf0008',
    'builder-submission-link': '01cf0009',
    'builder-submission-review': '01cf0011',
    'event-occasion': '01cf0010',
  },
}

describe('loadVscoConfig', () => {
  let dir: string
  let configPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vsco-config-test-'))
    configPath = join(dir, 'vsco-config.json')
    resetVscoConfigCache()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetVscoConfigCache()
  })

  it('loads a valid config from disk', () => {
    writeFileSync(configPath, JSON.stringify(validConfig))
    const cfg = loadVscoConfig({ path: configPath })
    expect(cfg.studioBrandId).toBe('01brand0000000000000000000')
    expect(cfg.leadSources['booth-expo']).toBe('01ls0007')
    expect(cfg.customFields['interested-smile']).toBe('01cf0001')
  })

  it('returns the same object across calls (cached)', () => {
    writeFileSync(configPath, JSON.stringify(validConfig))
    const a = loadVscoConfig({ path: configPath })
    const b = loadVscoConfig({ path: configPath })
    expect(a).toBe(b)
  })

  it('throws a helpful error when the file is missing', () => {
    expect(() => loadVscoConfig({ path: configPath })).toThrow(
      /vsco-config\.json not found/,
    )
  })

  it('throws when JSON is malformed', () => {
    writeFileSync(configPath, '{ not json')
    expect(() => loadVscoConfig({ path: configPath })).toThrow(
      /failed to parse/i,
    )
  })

  it('throws when a required lead-source key is missing', () => {
    const broken = structuredClone(validConfig)
    // @ts-expect-error - deliberately removing a required key
    delete broken.leadSources['website-contact']
    writeFileSync(configPath, JSON.stringify(broken))
    expect(() => loadVscoConfig({ path: configPath })).toThrow(
      /leadSources\.website-contact/,
    )
  })

  it('throws when studioBrandId is empty', () => {
    const broken = structuredClone(validConfig)
    broken.studioBrandId = ''
    writeFileSync(configPath, JSON.stringify(broken))
    expect(() => loadVscoConfig({ path: configPath })).toThrow(
      /studioBrandId/,
    )
  })

  it('throws when a custom field key is missing', () => {
    const broken = structuredClone(validConfig)
    // @ts-expect-error - deliberately removing a required key
    delete broken.customFields['reserved-package']
    writeFileSync(configPath, JSON.stringify(broken))
    expect(() => loadVscoConfig({ path: configPath })).toThrow(
      /customFields\.reserved-package/,
    )
  })

  it('throws when a job role is missing', () => {
    const broken = structuredClone(validConfig)
    // @ts-expect-error - deliberately removing a required key
    delete broken.jobRoles['partner-a']
    writeFileSync(configPath, JSON.stringify(broken))
    expect(() => loadVscoConfig({ path: configPath })).toThrow(
      /jobRoles\.partner-a/,
    )
  })
})
