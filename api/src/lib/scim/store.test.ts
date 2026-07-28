import { describe, expect, it } from 'vitest'
import { selectExpired } from './store'

/**
 * This function decides which rows get destroyed, so it is tested for the things
 * that would destroy the wrong ones rather than for the happy path.
 *
 * The house rule it inherits from scripts/Remove-ExpiredDemoAccounts.ps1: fail
 * toward a leak, never toward a delete. A row left behind shows up as a growing
 * table, which somebody notices. A row deleted in error shows up as data that
 * used to be there, which nobody does.
 */

const HOUR = 3600_000
const NOW = Date.parse('2026-07-28T18:00:00.000Z')
const cutoff = NOW - 36 * HOUR

const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString()

describe('selectExpired', () => {
  it('selects rows older than the cutoff', () => {
    const rows = [
      { rowKey: 'old', created: at(40) },
      { rowKey: 'ancient', created: at(500) },
    ]
    expect(selectExpired(rows, cutoff)).toEqual(['old', 'ancient'])
  })

  it('leaves rows inside the TTL alone', () => {
    const rows = [
      { rowKey: 'fresh', created: at(1) },
      { rowKey: 'recent', created: at(35) },
    ]
    expect(selectExpired(rows, cutoff)).toEqual([])
  })

  it('is exclusive at the boundary, so a row exactly at the TTL survives', () => {
    // Ties go to the row. One extra hour of a demo record is free; the reverse is
    // an off-by-one that deletes something a visitor is still looking at.
    expect(selectExpired([{ rowKey: 'edge', created: at(36) }], cutoff)).toEqual([])
    expect(selectExpired([{ rowKey: 'past', created: at(36.01) }], cutoff)).toEqual(['past'])
  })

  it('NEVER selects a row whose created stamp will not parse', () => {
    // The dangerous direction. An unparseable date must not read as "very old".
    const rows = [
      { rowKey: 'empty', created: '' },
      { rowKey: 'junk', created: 'not-a-date' },
      { rowKey: 'missing', created: undefined as unknown as string },
      { rowKey: 'null', created: null as unknown as string },
    ]
    expect(selectExpired(rows, cutoff)).toEqual([])
  })

  it('picks only the expired ones out of a mixed set', () => {
    const rows = [
      { rowKey: 'fresh', created: at(2) },
      { rowKey: 'old', created: at(48) },
      { rowKey: 'junk', created: 'nope' },
      { rowKey: 'edge', created: at(36) },
      { rowKey: 'older', created: at(72) },
    ]
    expect(selectExpired(rows, cutoff)).toEqual(['old', 'older'])
  })

  it('handles an empty table', () => {
    expect(selectExpired([], cutoff)).toEqual([])
  })

  it('does not mutate what it was given', () => {
    const rows = [{ rowKey: 'old', created: at(99) }]
    const before = JSON.stringify(rows)
    selectExpired(rows, cutoff)
    expect(JSON.stringify(rows)).toBe(before)
  })
})
