import { beforeEach, describe, expect, it } from 'vitest'
import {
  HUMAN_FLOOR_MS,
  STALE_AFTER_MS,
  clearLastFlow,
  markFlowStart,
  matchFlow,
  readLastFlow,
} from './lastFlow'

// The bug this guards against: the timeline showed a recording of a flow the
// visitor had not performed. Claiming the wrong flow is worse than claiming
// nothing, because it makes every other number on the page look invented too.

describe('we only claim a flow when we actually know it', () => {
  it('knows it was SSO-bypassed when this app sent prompt=login', () => {
    // Deterministic — we sent the parameter, so there is nothing to infer.
    expect(matchFlow('force-credentials', 12_000)).toMatchObject({
      kind: 'matched',
      flow: 'sso-off',
    })
  })

  it('knows it was SSO when it finished faster than a human can type', () => {
    expect(matchFlow('default', 1_100)).toMatchObject({ kind: 'matched', flow: 'sso-on' })
  })

  it('refuses to guess once a human has clearly interacted', () => {
    // Could be sign-in, sign-up, or a consent screen. Picking one would be the
    // original bug wearing a different hat.
    expect(matchFlow('default', 20_000)).toMatchObject({ kind: 'ambiguous' })
  })

  it('puts the boundary where a human genuinely cannot have typed', () => {
    expect(matchFlow('default', HUMAN_FLOOR_MS - 1)?.kind).toBe('matched')
    expect(matchFlow('default', HUMAN_FLOOR_MS + 1)?.kind).toBe('ambiguous')
  })

  it('says nothing at all when it has nothing to go on', () => {
    expect(matchFlow(null, 1_000)).toBeNull()
    expect(matchFlow('default', null)).toBeNull()
    // A clock that went backwards is not evidence of a fast sign-in.
    expect(matchFlow('default', -5)).toBeNull()
  })
})

describe('the elapsed time is frozen, not a running clock', () => {
  beforeEach(() => clearLastFlow())

  it('says nothing on a cold load, so the page shows recorded samples', () => {
    expect(readLastFlow()).toBeNull()
  })

  it('discards a marker left by a redirect that never came back', () => {
    // The actual bug: elapsed was recomputed on every render, so an abandoned
    // sign-in eventually announced "your sign-in took 825.0s".
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', String(Date.now() - (STALE_AFTER_MS + 1)))
    expect(readLastFlow()).toBeNull()
  })

  it('freezes the measurement instead of letting it grow', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', String(Date.now() - 1_200))

    const first = readLastFlow()
    expect(first).toMatchObject({ kind: 'matched', flow: 'sso-on' })

    // Read again later: the number must be identical, not larger.
    const second = readLastFlow()
    expect(second).toEqual(first)
  })

  it('consumes the marker once, so an old attempt cannot resurface', () => {
    markFlowStart('force-credentials')
    readLastFlow()
    clearLastFlow()
    expect(readLastFlow()).toBeNull()
  })

  it('forgets everything on sign-out', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', String(Date.now() - 1_000))
    expect(readLastFlow()).not.toBeNull()

    clearLastFlow()
    expect(readLastFlow()).toBeNull()
  })
})
