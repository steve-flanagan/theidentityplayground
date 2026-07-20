import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP2_STALE_AFTER_MS,
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
  const token = fakeIdToken({ aud: APP2_CLIENT_ID })

  beforeEach(() => {
    sessionStorage.clear()
  })

  // The interval ends where the browser came back, which is
  // `performance.timeOrigin`, so a start stamp placed N ms before that anchor is
  // an elapsed time of exactly N. Seeding with `Date.now() - N` describes
  // nothing now that the interval no longer ends at `Date.now()`.
  const startedBeforeLanding = (elapsedMs: number) =>
    String(performance.timeOrigin - elapsedMs)

  it('has a usable time origin to anchor against', () => {
    // Not a test of our logic. It makes a failure below read as "the reasoning
    // is wrong" rather than "this environment has no performance.timeOrigin".
    expect(Number.isFinite(performance.timeOrigin)).toBe(true)
  })

  it('stamps the click on the same clock the landing is read from', () => {
    markApp2Start()
    const stamped = Number(sessionStorage.getItem('tip.app2.start'))
    // `Date.now()` at the click, `performance.timeOrigin` at the landing. Both
    // are epoch milliseconds, which is what makes subtracting them meaningful.
    expect(Number.isFinite(stamped)).toBe(true)
    expect(Math.abs(stamped - Date.now())).toBeLessThan(1_000)
  })

  it('measures the click to the landing, not the click to the end of SPA boot', () => {
    // THE REGRESSION. Anchored on `Date.now()` this returned the 1441 ms round
    // trip plus however long the app took to boot, and boot on its own is
    // enough to clear HUMAN_FLOOR_MS. classifyAcquisition then declines to call
    // a genuine SSO an SSO, on the one page whose whole subject is SSO.
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(1_441))

    const elapsedMs = completeApp2Timing()
    expect(elapsedMs).toBe(1_441)
    expect(classifyAcquisition(token, elapsedMs).kind).toBe('sso')
  })

  it('is not moved by how late in the boot the marker is read', () => {
    // The whole reason for anchoring on timeOrigin: it is fixed for the life of
    // the document, so two reads at different moments in one boot cannot
    // disagree, and a slow boot cannot inflate either of them.
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(1_441))
    expect(completeApp2Timing()).toBe(1_441)
    expect(readApp2Elapsed()).toBe(1_441)
  })

  it('still refuses to call a genuinely interactive round trip SSO', () => {
    // The anchor moves the number down by a second or two. It must not move
    // this case across the floor — twenty seconds had a person in it either way.
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(20_000))

    const elapsedMs = completeApp2Timing()
    expect(elapsedMs).toBe(20_000)
    expect(classifyAcquisition(token, elapsedMs).kind).toBe('interactive')
  })

  it('turns a start stamp into an elapsed time that survives a refresh', () => {
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(1_441))
    const elapsed = completeApp2Timing()
    // The point of persisting it: a second read, as a reload would do, still
    // knows how the token in this tab was obtained.
    expect(readApp2Elapsed()).toBe(elapsed)
  })

  it('does not reuse a stale start stamp for a second round trip', () => {
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(1_441))
    completeApp2Timing()
    // A refresh with no new redirect must fall back to the stored measurement,
    // not re-measure from a start stamp that was already consumed.
    const stored = readApp2Elapsed()
    expect(completeApp2Timing()).toBe(stored)
  })

  it('reports nothing rather than a wrong number when there is no measurement', () => {
    expect(readApp2Elapsed()).toBeNull()
    expect(completeApp2Timing()).toBeNull()
  })
})

describe('an anchor that cannot carry a number produces no number', () => {
  const token = fakeIdToken({ aud: APP2_CLIENT_ID })

  beforeEach(() => {
    sessionStorage.clear()
  })

  const startedBeforeLanding = (elapsedMs: number) =>
    String(performance.timeOrigin - elapsedMs)

  it('drops a start stamped after this document began loading', () => {
    // Nothing navigated between the click and this read: the document doing the
    // reading is the one that did the clicking, or one the browser restored
    // from its back/forward cache. Its time origin predates the click, so there
    // is no round trip here to measure. Reachable by clicking and hitting Back.
    sessionStorage.setItem('tip.app2.start', String(performance.timeOrigin + 5_000))
    expect(completeApp2Timing()).toBeNull()
  })

  it('drops garbage in storage', () => {
    sessionStorage.setItem('tip.app2.start', 'not-a-number')
    expect(completeApp2Timing()).toBeNull()
  })

  it('drops an environment with no usable time origin', () => {
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(1_441))
    expect(completeApp2Timing(Number.NaN)).toBeNull()
  })

  it('writes nothing, so the page says untimed rather than guessing', () => {
    sessionStorage.setItem('tip.app2.start', String(performance.timeOrigin + 5_000))
    completeApp2Timing()
    expect(readApp2Elapsed()).toBeNull()
    expect(classifyAcquisition(token, readApp2Elapsed()).kind).toBe('untimed')
  })
})

describe('a redirect that did not come back on its own', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  const startedBeforeLanding = (elapsedMs: number) =>
    String(performance.timeOrigin - elapsedMs)

  it('drops a marker older than the staleness bound', () => {
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(APP2_STALE_AFTER_MS + 1))
    expect(completeApp2Timing()).toBeNull()
    // Nothing was written, so nothing is shown. An elapsed time that measures a
    // visitor wandering off is worse than no elapsed time.
    expect(readApp2Elapsed()).toBeNull()
  })

  it('keeps one sitting exactly on the bound', () => {
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(APP2_STALE_AFTER_MS))
    expect(completeApp2Timing()).toBe(APP2_STALE_AFTER_MS)
  })

  it('consumes the marker even when it is too old to report', () => {
    // The start key is cleared before the staleness check, so the marker is
    // single-use regardless of the window. An abandoned redirect can never be
    // left lying around for a later one to pick up and report as its own.
    sessionStorage.setItem('tip.app2.start', startedBeforeLanding(APP2_STALE_AFTER_MS + 1))
    completeApp2Timing()
    expect(sessionStorage.getItem('tip.app2.start')).toBeNull()
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
