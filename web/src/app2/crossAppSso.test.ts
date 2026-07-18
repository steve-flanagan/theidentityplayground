import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyAcquisition,
  completeApp2Timing,
  markApp2Start,
  readApp2Elapsed,
  readAudience,
} from './crossAppSso'
import { isApp2Path } from './route'
import { APP2_CLIENT_ID } from '../auth/app2MsalConfig'
import { HUMAN_FLOOR_MS } from '../lib/lastFlow'

// Cross-app SSO cannot be exercised here — Entra sign-in fails in this
// environment with AADSTS50058 — so what gets tested is the part that decides
// what the page is ALLOWED TO SAY about a token. That is the part with a
// credibility cost if it is wrong: a page that calls a full credential entry
// "single sign-on" is worse than no page.

/** A JWT-shaped string with a real payload. Signature is never checked. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.not-a-signature`
}

describe('the audience claim is what proves which app got the token', () => {
  it('reads a string aud', () => {
    expect(readAudience(fakeIdToken({ aud: APP2_CLIENT_ID }))).toBe(APP2_CLIENT_ID)
  })

  it('reads an array aud, which the spec allows even though Entra sends a string', () => {
    expect(readAudience(fakeIdToken({ aud: [APP2_CLIENT_ID, 'other'] }))).toBe(APP2_CLIENT_ID)
  })

  it('returns null rather than throwing on anything that is not a readable token', () => {
    expect(readAudience('not-a-jwt')).toBeNull()
    expect(readAudience('')).toBeNull()
    expect(readAudience(fakeIdToken({ sub: 'no-aud-here' }))).toBeNull()
  })
})

describe('what the page may claim about how the token arrived', () => {
  const token = fakeIdToken({ aud: APP2_CLIENT_ID })

  it('calls it SSO only when the round trip was faster than a human can type', () => {
    const result = classifyAcquisition(token, HUMAN_FLOOR_MS - 1)
    expect(result.kind).toBe('sso')
  })

  it('refuses to call it SSO once there was time for someone to interact', () => {
    // The boundary belongs on the cautious side: exactly at the floor we do
    // NOT claim SSO. An over-claim here is the failure mode that matters.
    expect(classifyAcquisition(token, HUMAN_FLOOR_MS).kind).toBe('interactive')
    expect(classifyAcquisition(token, 20_000).kind).toBe('interactive')
  })

  it('says the timing is missing rather than inventing one', () => {
    expect(classifyAcquisition(token, null).kind).toBe('untimed')
  })

  it('refuses a token addressed to a different client, however fast it arrived', () => {
    const foreign = fakeIdToken({ aud: 'e891bf4d-ab35-4686-81b9-a973001b378f' })
    const result = classifyAcquisition(foreign, 12)
    expect(result.kind).toBe('foreign-audience')
    // Whatever it is, it must not be dressed up as this app's SSO win.
    expect(result.kind).not.toBe('sso')
  })
})

describe('measuring the round trip across a redirect', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('turns a start stamp into an elapsed time that survives a refresh', () => {
    markApp2Start()
    const elapsed = completeApp2Timing()
    expect(elapsed).not.toBeNull()
    expect(elapsed!).toBeGreaterThanOrEqual(0)
    // The point of persisting it: a second read, as a reload would do, still
    // knows how the token in this tab was obtained.
    expect(readApp2Elapsed()).toBe(elapsed)
  })

  it('does not reuse a stale start stamp for a second round trip', () => {
    markApp2Start()
    completeApp2Timing()
    // A refresh with no new redirect must fall back to the stored measurement,
    // not re-measure from a start stamp that was already consumed.
    const stored = readApp2Elapsed()
    expect(completeApp2Timing(Date.now() + 60_000)).toBe(stored)
  })

  it('reports nothing rather than a wrong number when there is no measurement', () => {
    expect(readApp2Elapsed()).toBeNull()
    expect(completeApp2Timing()).toBeNull()
  })
})

describe('the /app2 route', () => {
  it('matches with and without a trailing slash', () => {
    expect(isApp2Path('/app2')).toBe(true)
    expect(isApp2Path('/app2/')).toBe(true)
  })

  it('does not swallow the main app or anything near it', () => {
    expect(isApp2Path('/')).toBe(false)
    expect(isApp2Path('/app2/deeper')).toBe(false)
    expect(isApp2Path('/app22')).toBe(false)
    expect(isApp2Path('/blank.html')).toBe(false)
  })
})
