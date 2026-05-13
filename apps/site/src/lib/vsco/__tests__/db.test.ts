/**
 * Smoke tests for the VSCO schema additions: qualified_at column,
 * vsco_entities table, vsco_pushes table. Verifies the migration runs
 * cleanly and the schema is as expected.
 *
 * Helper functions (recordVscoEntities, markInquiryQualified, etc.) use
 * the prod singleton `getDb()` so they can't be tested here without
 * touching the real disk. Their behavior is exercised end-to-end in the
 * push-layer tests (Task 7) using SMILE_NOLA_DB_DIR pointing at a temp
 * directory.
 */

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { bootstrapSchema } from '@/lib/db'

function freshDb(): Database.Database {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  bootstrapSchema(d)
  return d
}

describe('VSCO schema migration', () => {
  it('adds qualified_at column to inquiries', () => {
    const db = freshDb()
    const cols = db.prepare('PRAGMA table_info(inquiries)').all() as Array<{
      name: string
    }>
    expect(cols.map((c) => c.name)).toContain('qualified_at')
  })

  it('creates vsco_entities table with composite PK', () => {
    const db = freshDb()
    const tbl = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='vsco_entities'",
      )
      .get()
    expect(tbl).toBeDefined()
    const cols = db.prepare('PRAGMA table_info(vsco_entities)').all() as Array<{
      name: string
      pk: number
    }>
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name)
    expect(pkCols.sort()).toEqual(['external_uuid', 'kind'])
  })

  it('creates vsco_pushes audit table with all expected columns', () => {
    const db = freshDb()
    const cols = db.prepare('PRAGMA table_info(vsco_pushes)').all() as Array<{
      name: string
    }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'builder_id',
        'created_at',
        'duration_ms',
        'error_body',
        'external_uuid',
        'http_status',
        'id',
        'inquiry_id',
        'notes',
        'trigger',
        'verdict',
      ].sort(),
    )
  })

  it('migration is idempotent: running bootstrap twice changes nothing', () => {
    const db = freshDb()
    bootstrapSchema(db) // run again
    bootstrapSchema(db) // and again
    const cols = db.prepare('PRAGMA table_info(inquiries)').all() as Array<{
      name: string
    }>
    // qualified_at appears exactly once
    const matches = cols.filter((c) => c.name === 'qualified_at')
    expect(matches).toHaveLength(1)
  })

  it('can insert and retrieve a vsco_entities row', () => {
    const db = freshDb()
    db.prepare(
      'INSERT INTO vsco_entities (external_uuid, kind, vsco_id) VALUES (?, ?, ?)',
    ).run('uuid-1', 'job', 'JOB_ULID_001')
    const row = db
      .prepare<[string, string], { vsco_id: string }>(
        'SELECT vsco_id FROM vsco_entities WHERE external_uuid = ? AND kind = ?',
      )
      .get('uuid-1', 'job')
    expect(row?.vsco_id).toBe('JOB_ULID_001')
  })

  it('vsco_entities composite PK prevents duplicate (uuid, kind) pairs', () => {
    const db = freshDb()
    db.prepare(
      'INSERT INTO vsco_entities (external_uuid, kind, vsco_id) VALUES (?, ?, ?)',
    ).run('uuid-1', 'job', 'JOB_001')
    expect(() => {
      db.prepare(
        'INSERT INTO vsco_entities (external_uuid, kind, vsco_id) VALUES (?, ?, ?)',
      ).run('uuid-1', 'job', 'JOB_002')
    }).toThrow(/UNIQUE/i)
  })

  it('allows multiple kinds for the same external_uuid', () => {
    const db = freshDb()
    db.prepare(
      'INSERT INTO vsco_entities (external_uuid, kind, vsco_id) VALUES (?, ?, ?)',
    ).run('uuid-1', 'job', 'JOB_001')
    db.prepare(
      'INSERT INTO vsco_entities (external_uuid, kind, vsco_id) VALUES (?, ?, ?)',
    ).run('uuid-1', 'contact-poc', 'CONT_001')
    const rows = db
      .prepare('SELECT * FROM vsco_entities WHERE external_uuid = ? ORDER BY kind')
      .all('uuid-1') as Array<{ kind: string; vsco_id: string }>
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.kind).sort()).toEqual(['contact-poc', 'job'])
  })

  it('vsco_pushes accepts a full audit row with all fields', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO vsco_pushes (
         external_uuid, inquiry_id, builder_id, trigger, verdict,
         http_status, error_body, duration_ms, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('u-1', 7, null, 'inquiry-create', 'ok', 201, null, 432, 'first push')
    const row = db
      .prepare('SELECT * FROM vsco_pushes WHERE inquiry_id = ?')
      .get(7) as { verdict: string; http_status: number; duration_ms: number }
    expect(row.verdict).toBe('ok')
    expect(row.http_status).toBe(201)
    expect(row.duration_ms).toBe(432)
  })
})
