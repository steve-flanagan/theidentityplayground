/**
 * The SCIM stage has now claimed success for a run that wrote nothing twice, in
 * two different ways: once from a hardcoded `PATCH /Users` string, and once from
 * a fallback that returned the last call when it found no write. Both shipped.
 *
 * The rule this file exists to hold: a read is never a write. Whatever else
 * Entra sends, only a POST or a PATCH changes the downstream app, and only that
 * is allowed to light the stage.
 *
 * The call lists are the real shapes, taken from the events store on 31 July.
 */

import { describe, expect, it } from 'vitest'
import { scimOutcome } from './ScimDemo'

/** A terminate Entra decided against: it read, compared, and stopped. */
const READ_ONLY = [
  'GET /Users?filter=userName eq "f7e232c5-50d0-44df-b374-4fd175b3"',
  'GET /Users/dd8dcb72-44ce-4db8-a192-e53df5eec334',
]

/** The same terminate when the mapping did see a difference. */
const WROTE = [...READ_ONLY, 'PATCH /Users/63593096-2435-458b-8f37-50854653997f']

describe('scimOutcome', () => {
  it('reports the write when Entra sent one', () => {
    const { write, readOnly } = scimOutcome(WROTE, 'PATCH')
    expect(write).toBe('PATCH /Users/63593096-2435-458b-8f37-50854653997f')
    expect(readOnly).toBe(false)
  })

  // The regression. Reads are what a successful run and a no-op run have in
  // common, so they must never stand in for the write.
  it('does NOT treat a trailing GET as the write', () => {
    const { write, readOnly } = scimOutcome(READ_ONLY, 'PATCH')
    expect(write).toBeNull()
    expect(readOnly).toBe(true)
  })

  it('separates read-and-decline from a run that never arrived', () => {
    expect(scimOutcome([], 'PATCH')).toEqual({ write: null, readOnly: false })
  })

  // Each direction looks for its own verb. A hire that only produced the
  // terminate's PATCH has not been provisioned, and vice versa.
  it('does not accept the other direction’s verb', () => {
    expect(scimOutcome(WROTE, 'POST').write).toBeNull()
    expect(scimOutcome(['POST /Users'], 'PATCH').write).toBeNull()
  })

  it('finds the write wherever it sits in the sequence', () => {
    const calls = ['GET /Users?filter=...', 'POST /Users', 'GET /Users/abc']
    expect(scimOutcome(calls, 'POST').write).toBe('POST /Users')
  })
})
