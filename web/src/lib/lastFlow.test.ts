import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCOUNT_CREATED_CLAIM,
  HUMAN_FLOOR_MS,
  STALE_AFTER_MS,
  WINDOW_TOLERANCE_MS,
  accountCreatedAtMs,
  clearLastFlow,
  markFlowStart,
  matchFlow,
  readLastFlow,
  resolveAmbiguous,
  settleLastFlow,
  type FlowMatch,
} from './lastFlow'
import { CLAIMS } from './claims'
import { decodeJwt } from './jwt'
import { buildSampleToken } from './sampleToken'

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

  it('knows it was a sign-out, because this app started it', () => {
    // Deterministic like prompt=login. The intent comes from the global button,
    // which redirects; the local one never gets here because it never leaves the
    // page. Both still resolve to the one 'signout' flow, because there is
    // exactly one sign-out capture and the local/global split is taught inside
    // it rather than as a second flow.
    expect(matchFlow('sign-out', 900)).toMatchObject({
      kind: 'matched',
      flow: 'signout',
    })
  })

  it('does not let the human floor turn a slow sign-out into a guess', () => {
    // The floor is an inference about typing, and nothing was typed here. A
    // sign-out that took twenty seconds is still a sign-out.
    expect(matchFlow('sign-out', 20_000)).toMatchObject({
      kind: 'matched',
      flow: 'signout',
    })
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

// A start stamp N milliseconds before this document's navigation began, which
// under the current anchor is exactly an elapsed time of N. Every case below
// used `Date.now() - N`, and that stopped describing an elapsed time once the
// interval stopped ending at Date.now(). See "the interval ends where the
// browser came back" for what changed and why.
const startedBeforeLanding = (elapsedMs: number) =>
  String(performance.timeOrigin - elapsedMs)

describe('the elapsed time is frozen, not a running clock', () => {
  beforeEach(() => clearLastFlow())

  it('says nothing on a cold load, so the page shows recorded samples', () => {
    expect(readLastFlow()).toBeNull()
  })

  it('discards a marker left by a redirect that never came back', () => {
    // The actual bug: elapsed was recomputed on every render, so an abandoned
    // sign-in eventually announced "your sign-in took 825.0s".
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(STALE_AFTER_MS + 1))
    expect(readLastFlow()).toBeNull()
  })

  it('freezes the measurement instead of letting it grow', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_200))

    const first = readLastFlow()
    expect(first).toMatchObject({ kind: 'matched', flow: 'sso-on' })

    // Read again later: the number must be identical, not larger.
    const second = readLastFlow()
    expect(second).toEqual(first)
  })

  it('consumes the marker once, so an old attempt cannot resurface', () => {
    markFlowStart('force-credentials')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_200))
    // Non-null first, or the null at the end proves nothing about consumption.
    expect(readLastFlow()).not.toBeNull()

    clearLastFlow()
    expect(readLastFlow()).toBeNull()
  })

  it('forgets everything on sign-out', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_000))
    expect(readLastFlow()).not.toBeNull()

    clearLastFlow()
    expect(readLastFlow()).toBeNull()
  })
})

// Everything below is the GLOBAL sign-out. It is the only one that redirects,
// which is the only reason there is an elapsed time to freeze.
//
// The local button used to mark itself here too, and that was the defect: with
// no navigation nothing ever came back to read the stamp, so it sat in storage
// and the next unrelated page load reported the idle minutes since the click as
// the flow's duration. It now selects the sign-out flow in the page instead, and
// touches none of this.
describe('a sign-out marks itself, and survives the redirect that performs it', () => {
  beforeEach(() => clearLastFlow())

  it('writes the marker before logoutRedirect can unload the page', () => {
    // logoutRedirect navigates away. Anything not already in storage when it is
    // called does not come back, so this write cannot be deferred behind it.
    markFlowStart('sign-out')

    expect(sessionStorage.getItem('tip.flow.intent')).toBe('sign-out')
    expect(sessionStorage.getItem('tip.flow.start')).not.toBeNull()
  })

  it('lands on the sign-out flow when Entra sends the browser back', () => {
    // The global path in full: mark, unload, session ended at Entra, redirect
    // back, read. sessionStorage is what bridges the unload, so the read on the
    // far side is the same storage the mark went into.
    markFlowStart('sign-out')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(800))

    expect(readLastFlow()).toMatchObject({ kind: 'matched', flow: 'signout' })
  })

  it('replaces the sign-in it undid instead of leaving it up', () => {
    // The defect: sign-out wiped the marker and put nothing back, so the
    // timeline selected nothing at all.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_000))
    expect(readLastFlow()).toMatchObject({ kind: 'matched', flow: 'sso-on' })

    // Exactly what SignInPanel does on the "sign out everywhere" button.
    clearLastFlow()
    markFlowStart('sign-out')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(800))

    expect(readLastFlow()).toMatchObject({ kind: 'matched', flow: 'signout' })
  })

  it('does not resurrect the undone sign-in when the sign-out goes stale', () => {
    // The redirect can fail to come back: the visitor abandons Entra's sign-out
    // page, or leaves the tab and returns an hour later. The sign-out is
    // correctly discarded past the stale window, and the sign-in it undid must
    // not surface in its place — that would claim a session that has ended.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_000))
    expect(readLastFlow()).not.toBeNull()

    clearLastFlow()
    markFlowStart('sign-out')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(STALE_AFTER_MS + 1))

    expect(readLastFlow()).toBeNull()
  })
})

// The measurement bug, and the one that hurt most, because the number was
// plausible. Steve signed in, Entra reused his session and returned with no
// prompt at all, and the timeline told him it took 3.8s and therefore wasn't
// SSO. The HAR of that sign-in:
//
//   openid-configuration    200        0 ms → 161
//   /oauth2/v2.0/authorize  302      193 ms → 1441      <- 302, straight back
//                                    [ 2358 ms idle ]   <- the SPA booting
//   openid-configuration    200     3799 ms
//   /oauth2/v2.0/token      200     3811 ms → 4043
//
// No GetCredentialType, no /login, no /kmsi, so nothing was ever shown to him.
// He was at Entra for 1.4s. The other 2.4s was this app cold-booting before the
// marker got read, and Date.now() was counting it.
describe('the interval ends where the browser came back, not where the app finished booting', () => {
  beforeEach(() => clearLastFlow())

  it('has a usable time origin to anchor against', () => {
    // Not a test of our logic — a test that the anchor exists at all, so that a
    // failure below reads as "the reasoning is wrong" and not "this environment
    // has no performance.timeOrigin".
    expect(Number.isFinite(performance.timeOrigin)).toBe(true)
  })

  it('calls the 1441 ms redirect from that HAR what it was: SSO', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_441))

    const match = readLastFlow()
    expect(match).toMatchObject({ kind: 'matched', flow: 'sso-on' })
    // The exact 1441, not 1441 plus however long this process has been up.
    // Under the old anchor this was 4043 and the banner said "a prompt was
    // involved". Asserting the number, not just the verdict, is the point:
    // the verdict was only wrong because the number was.
    expect((match as { elapsedMs: number }).elapsedMs).toBe(1_441)
  })

  it('is not moved by how late in the app boot the marker is read', () => {
    // The whole reason for anchoring on timeOrigin rather than "now". It is
    // fixed for the document, so two reads at different moments in the same
    // boot cannot disagree, and a slow boot cannot inflate either.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_441))

    const first = readLastFlow()
    clearLastFlow()

    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(1_441))
    expect(readLastFlow()).toEqual(first)
  })

  it('still refuses to guess when someone actually sat there and typed', () => {
    // Steve's genuine interactive capture: 18.7s at Entra. Trimming boot time
    // off that changes nothing about it, which is the other half of the fix
    // working — the floor had to keep catching what it was built to catch.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(18_700))

    expect(readLastFlow()).toMatchObject({ kind: 'ambiguous' })
  })

  it('reports nothing when no navigation happened between the click and the read', () => {
    // markFlowStart stamps Date.now(), which is always after the current
    // document's time origin. So a marker written and then read without any
    // redirect in between subtracts to a negative, and there is genuinely no
    // round trip to describe. Silence is the honest answer; a number is not.
    markFlowStart('default')

    expect(readLastFlow()).toBeNull()
  })

  it('reports nothing when the document is older than the click', () => {
    // The back/forward cache restores the ORIGINAL document, so its time origin
    // predates the click that has just been stamped into it. Same guard, and
    // worth naming separately because it is the one a person can trigger by
    // clicking sign-in and then hitting Back.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', String(performance.timeOrigin + 5_000))

    expect(readLastFlow()).toBeNull()
  })

  it('reports nothing when the stored stamp is not a number', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', 'not-a-time')

    expect(readLastFlow()).toBeNull()
  })

  it('measures the sign-out round trip the same way', () => {
    // signOutEverywhere uses this same marker and this same freeze path, and
    // its interval is a real redirect round trip, so the anchor is right for it
    // too. All that changed is that its number no longer carries boot time.
    markFlowStart('sign-out')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(900))

    const match = readLastFlow()
    expect(match).toMatchObject({ kind: 'matched', flow: 'signout' })
    expect((match as { elapsedMs: number }).elapsedMs).toBe(900)
  })
})

// ── Sign-up or sign-in ──────────────────────────────────────────────────────
//
// The one pair the round trip cannot separate: both put a person in front of
// Entra and both come back with a token. The answer comes from when Entra says
// the account was created, and the token carries that directly: a claims mapping
// policy on the app registration emits `createddatetime`.
//
// The question is whether that moment falls inside the window the flow ran in.
// Both ends of the window are browser-stamped, so these tests hand the window in
// rather than reading whatever clock the suite happens to run on.
//
// It used to be `iat` on the other side of the comparison. That is gone: see the
// 18 July regression at the end of this file for the measurement that took it
// out, and resolveAmbiguous for why no tolerance could rescue it.

const ISSUED_AT_SECONDS = 1_800_000_000

const seg = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A JWT carrying nothing but the one claim this reasoning reads. */
function tokenIssuedAt(iat: unknown): string {
  return `${seg({ typ: 'JWT', alg: 'RS256' })}.${seg({ iat })}.NOT_A_SIGNATURE`
}

/** A JWT shaped like the real one: an `iat`, and the mapped creation claim. */
function tokenCreatedAt(created: unknown, iat: unknown = ISSUED_AT_SECONDS): string {
  const payload: Record<string, unknown> = { iat }
  // Explicit, so "the claim is absent" and "the claim is present and empty"
  // are two different inputs here. Both have to end up saying nothing.
  if (created !== undefined) payload[ACCOUNT_CREATED_CLAIM] = created
  return `${seg({ typ: 'JWT', alg: 'RS256' })}.${seg(payload)}.NOT_A_SIGNATURE`
}

const INTERACTIVE = matchFlow('default', 20_000)
const TOKEN = tokenIssuedAt(ISSUED_AT_SECONDS)

/**
 * The moment the browser landed back from Entra, written down instead of
 * measured, so every window below is exact and none of it shifts with the clock
 * the suite runs on. Real value: Steve's 18 July sign-up.
 */
const LANDED_AT_MS = Date.parse('2026-07-18T23:17:41Z')

/** Created this many ms before the browser came back. */
const createdBeforeLanding = (ms: number) => LANDED_AT_MS - ms

/** resolveAmbiguous against the written-down window, which is the usual case. */
const resolve = (
  createdAtMs: number | null,
  token: string | null = TOKEN,
  match: FlowMatch = INTERACTIVE,
) => resolveAmbiguous(match, createdAtMs, token, LANDED_AT_MS)

describe('an account created inside the window was created by that flow', () => {
  it('starts from a genuinely ambiguous match, or the rest proves nothing', () => {
    expect(INTERACTIVE).toMatchObject({ kind: 'ambiguous', elapsedMs: 20_000 })
  })

  it('calls it a sign-up when the account appeared during the flow', () => {
    // Created five seconds before the browser came back, inside a flow that ran
    // for twenty. It cannot have been there when the visitor clicked.
    expect(resolve(createdBeforeLanding(5_000))).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })

  it('puts a real sign-up where the capture puts it, seconds before the landing', () => {
    // Not an edge case — the shape this has to get right. captures/signup.json
    // has POST /common/createuser at 50.4s of a 54.8s round trip, so the account
    // appears 4.4s before the browser comes back.
    const flow = matchFlow('default', 54_800)
    expect(resolveAmbiguous(flow, createdBeforeLanding(4_400), TOKEN, LANDED_AT_MS)).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })

  it('calls it a sign-in when the account was already there', () => {
    expect(resolve(createdBeforeLanding(3_600_000))).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })

  it('is not close on a returning visitor', () => {
    // The margin the design rests on: a day of age against a window tens of
    // seconds wide. This is why two clocks in the comparison are affordable.
    expect(resolve(createdBeforeLanding(24 * 60 * 60 * 1000))).toMatchObject({ flow: 'signin' })
  })

  it('keeps the measured elapsed time, and does not invent a new one', () => {
    // The banner prints this number. Resolving WHICH flow it was must not touch
    // HOW LONG it took — that was measured, and nothing here re-measures it.
    const signedUp = resolve(createdBeforeLanding(5_000))
    expect((signedUp as { elapsedMs: number }).elapsedMs).toBe(20_000)
  })

  it('puts the early boundary at the click, plus the tolerance', () => {
    // The click is 20s before the landing. Earlier than that plus the allowance
    // for two clocks, the account predates the flow and this is a sign-in.
    const edge = 20_000 + WINDOW_TOLERANCE_MS
    expect(resolve(createdBeforeLanding(edge))).toMatchObject({ flow: 'signup' })
    expect(resolve(createdBeforeLanding(edge + 1))).toMatchObject({ flow: 'signin' })
  })

  it('refuses an account dated after the flow that carried it', () => {
    // Impossible in that order. Inside the tolerance it is skew; past it a clock
    // is badly wrong, and then nothing is claimed rather than something guessed.
    expect(resolve(LANDED_AT_MS + WINDOW_TOLERANCE_MS)).toMatchObject({ flow: 'signup' })
    expect(resolve(LANDED_AT_MS + WINDOW_TOLERANCE_MS + 1)).toBe(INTERACTIVE)
  })
})

describe('two clocks in the comparison, and the margin that absorbs them', () => {
  // The window is browser-stamped and the creation time is Entra-stamped. That
  // offset is the price of dropping `iat`, and these are the two directions it
  // can run, at a size far past any machine that syncs its clock at all.
  const SKEW_MS = 5_000

  it('still calls a sign-up a sign-up when the browser clock runs fast', () => {
    // A fast browser dates the window later than it really was, so the creation
    // time reads earlier against it, back toward the click.
    expect(resolve(createdBeforeLanding(5_000 + SKEW_MS))).toMatchObject({ flow: 'signup' })
  })

  it('still calls a sign-up a sign-up when the browser clock runs slow', () => {
    // A slow browser dates the window earlier, so the creation time reads later,
    // past the landing. Inside the tolerance that is still a sign-up.
    expect(resolve(LANDED_AT_MS + SKEW_MS)).toMatchObject({ flow: 'signup' })
  })

  it('cannot turn a returning visitor into a sign-up at any plausible skew', () => {
    // The one error this page truly cannot make. A two-day-old account is not
    // reachable from a twenty-second window by any offset worth the name.
    const twoDays = 2 * 24 * 60 * 60 * 1000
    for (const skew of [-60_000, -5_000, 0, 5_000, 60_000]) {
      expect(
        resolveAmbiguous(INTERACTIVE, createdBeforeLanding(twoDays), TOKEN, LANDED_AT_MS + skew),
      ).toMatchObject({ flow: 'signin' })
    }
  })
})

describe('no signal means no claim, which is exactly today’s behaviour', () => {
  it('stays ambiguous when the claim said nothing', () => {
    expect(resolve(null)).toBe(INTERACTIVE)
  })

  it('stays ambiguous when there is no token to read the claim off', () => {
    expect(resolve(createdBeforeLanding(5_000), null)).toBe(INTERACTIVE)
  })

  it('stays ambiguous when the numbers are garbage', () => {
    expect(resolve(Number.NaN)).toBe(INTERACTIVE)
    expect(resolve(Infinity)).toBe(INTERACTIVE)
  })

  it('stays ambiguous when there is no window to test against', () => {
    // Either end can go missing: an environment with no readable time origin, or
    // a frozen elapsed time that is not a duration. Without both there is no
    // window, and a comparison against half a window is not a measurement.
    const created = createdBeforeLanding(5_000)
    expect(resolveAmbiguous(INTERACTIVE, created, TOKEN, Number.NaN)).toBe(INTERACTIVE)
    expect(resolveAmbiguous(INTERACTIVE, created, TOKEN, Infinity)).toBe(INTERACTIVE)

    const inverted: FlowMatch = { kind: 'ambiguous', elapsedMs: -1 }
    expect(resolveAmbiguous(inverted, created, TOKEN, LANDED_AT_MS)).toBe(inverted)
    const notADuration: FlowMatch = { kind: 'ambiguous', elapsedMs: Number.NaN }
    expect(resolveAmbiguous(notADuration, created, TOKEN, LANDED_AT_MS)).toBe(notADuration)
  })

  it('no longer bails on what iat says, because it no longer reads it', () => {
    // Every one of these used to return ambiguous, and the 18 July sign-up is
    // why they no longer do. In the app a token this broken yields a null
    // creation time and the first guard catches it, which the end-to-end cases
    // below still pin. This is only about iat being out of the reasoning.
    const created = createdBeforeLanding(5_000)
    for (const token of [tokenIssuedAt(undefined), tokenIssuedAt('soon'), 'not-a-jwt']) {
      expect(resolveAmbiguous(INTERACTIVE, created, token, LANDED_AT_MS)).toMatchObject({
        flow: 'signup',
      })
    }
  })
})

// ── Where the creation time comes from ──────────────────────────────────────
//
// It used to be a Graph call. Two requests, on a page whose argument is that it
// measures its own traffic, and neither of them appeared on any capture. The
// claim replaces both.
//
// The format is not assumed anywhere below. This is a mapped claim, so what
// lands in it is whatever the policy emits, and the tests are written against
// the shapes rather than against one documented string.

describe('the creation time is read off the token, with nothing on the wire', () => {
  it('reads the claim the tenant emits', () => {
    expect(accountCreatedAtMs(tokenCreatedAt('2026-07-16T19:32:51Z'))).toBe(
      Date.parse('2026-07-16T19:32:51Z'),
    )
  })

  it('accepts a space between the date and the time', () => {
    // V8 parses this and other engines do not, so it is normalised rather than
    // handed to Date.parse as it stands. Otherwise the same token resolves in
    // Chrome and stays ambiguous in Safari.
    expect(accountCreatedAtMs(tokenCreatedAt('2026-07-16 19:32:51Z'))).toBe(
      Date.parse('2026-07-16T19:32:51Z'),
    )
  })

  it('reads a value with no zone on it as UTC, never as local time', () => {
    // The one parse bug that could print a wrong badge. Local time drags the
    // browser's clock into a comparison built to keep it out, and west of UTC
    // it makes an account created hours ago look created just now.
    expect(accountCreatedAtMs(tokenCreatedAt('2026-07-16T19:32:51'))).toBe(
      Date.parse('2026-07-16T19:32:51Z'),
    )
  })

  it('accepts an epoch, in seconds or in milliseconds', () => {
    // Three orders of magnitude apart, so the two windows cannot overlap for any
    // date this claim can carry. Nothing to do with the flow window below.
    const asMs = ISSUED_AT_SECONDS * 1000
    expect(accountCreatedAtMs(tokenCreatedAt(ISSUED_AT_SECONDS))).toBe(asMs)
    expect(accountCreatedAtMs(tokenCreatedAt(asMs))).toBe(asMs)
  })

  it('says nothing on every shape it cannot read confidently', () => {
    expect(accountCreatedAtMs(null)).toBeNull()
    expect(accountCreatedAtMs('not-a-jwt')).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt(undefined))).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt(''))).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt('   '))).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt('whenever'))).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt(true))).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt({ when: 'then' }))).toBeNull()
    expect(accountCreatedAtMs(tokenCreatedAt(0))).toBeNull()
  })

  it('throws on nothing, whatever it is handed', () => {
    for (const bad of [null, '', 'x', 'a.b.c', '..', tokenCreatedAt('whenever')]) {
      expect(() => accountCreatedAtMs(bad)).not.toThrow()
    }
  })

  it('names the claim the same way the dictionary does', () => {
    // Two halves of one change: this reads the key, the inspector annotates it.
    // A rename that misses one drops the claim back under "Not yet annotated"
    // with nothing on the page saying why.
    expect(ACCOUNT_CREATED_CLAIM).toBe('createddatetime')
    expect(CLAIMS[ACCOUNT_CREATED_CLAIM]).toBeDefined()
  })

  it('carries the claim in the sample token too, under that same key', () => {
    // Nobody has signed in yet on most visits, so the sample is the only token
    // most people ever see. A set that is missing the claim hides an annotation
    // that was written for it, and makes the sample's own header comment false.
    const raw = decodeJwt(buildSampleToken()).payload[ACCOUNT_CREATED_CLAIM]

    // The format the tenant emits, not merely one the parser tolerates: a space
    // between the date and the time, whole seconds, Z on the end.
    expect(raw).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/)
    expect(accountCreatedAtMs(buildSampleToken())).not.toBeNull()
  })

  it('dates the sample account well before any window it could land in', () => {
    // The sample never reaches this reasoning in the app — only a real token
    // does. The coherence still has to hold, because a creation time seconds
    // old reads as an account that signed up during the flow on screen.
    //
    // No window is handed in here on purpose: the sample is built off the real
    // clock, so the real anchor is the one it has to be coherent with. This is
    // also the only case covering the default parameter.
    const token = buildSampleToken()
    expect(resolveAmbiguous(INTERACTIVE, accountCreatedAtMs(token), token)).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })
})

// Steve's account was created on 16 July 2026 and he signs in on the 18th. It is
// two days older than any flow it can appear in, so every sign-in of his has to
// read as a sign-in.
const STEVE_CREATED = '2026-07-16T19:32:51Z'

describe('the flow is settled from the claim, end to end', () => {
  it('calls a two-day-old account signing in a sign-in', () => {
    const token = tokenCreatedAt(STEVE_CREATED)
    expect(resolve(accountCreatedAtMs(token), token)).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })

  it('calls an account created inside the flow a sign-up', () => {
    // The same path with five seconds of age instead of two days.
    const token = tokenCreatedAt(new Date(createdBeforeLanding(5_000)).toISOString())
    expect(resolve(accountCreatedAtMs(token), token)).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })

  it('stays ambiguous when the claim is absent, empty, or not a date', () => {
    // A token issued before the mapping policy existed, or one where the policy
    // stopped applying. The page then says what it said before any of this: it
    // measured a flow, and it is not naming which.
    for (const value of [undefined, '', '   ', 'whenever', 42, true]) {
      const token = tokenCreatedAt(value)
      expect(resolve(accountCreatedAtMs(token), token)).toBe(INTERACTIVE)
    }
  })
})

// ── The staleness window ────────────────────────────────────────────────────
//
// The bound was five minutes, sized on a sign-in. Sign-up does not fit in it:
// External ID mails a verification code, and the wait for that email sits inside
// the measured round trip. So the slowest sign-ups were the only flows getting
// no badge at all, which is the wrong way round.
//
// These sit here rather than up with the other freeze tests because the sign-up
// half needs the token helpers defined above.
describe('a sign-up slow enough to wait on an email still gets its badge', () => {
  beforeEach(() => clearLastFlow())

  it('is set at fifteen minutes', () => {
    // Pinned. The value is the whole change, and a quiet drift back to five
    // would put the case below out of reach with every other test still green.
    expect(STALE_AFTER_MS).toBe(15 * 60_000)
  })

  it('keeps a nine-minute flow instead of discarding it', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(9 * 60_000))

    const match = readLastFlow()
    expect(match).toMatchObject({ kind: 'ambiguous' })
    expect((match as { elapsedMs: number }).elapsedMs).toBe(9 * 60_000)
  })

  it('badges that nine-minute flow as the sign-up it was', () => {
    // The end this is for. Nine minutes of round trip, most of it spent waiting
    // on the code, and the account created half a minute before the browser came
    // back. Under the old bound the whole thing was thrown away before it got
    // anywhere near resolveAmbiguous.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(9 * 60_000))
    expect(readLastFlow()).toMatchObject({ kind: 'ambiguous' })

    // settleLastFlow takes no window, so the creation time is placed against the
    // real anchor, inside the nine minutes seeded above.
    expect(settleLastFlow(performance.timeOrigin - 30_000, TOKEN)).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })

  it('keeps the flow landing exactly on the bound', () => {
    // The guard is `>`, so the bound itself is inside it. An off-by-one here is
    // invisible everywhere else.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(STALE_AFTER_MS))

    expect(readLastFlow()).not.toBeNull()
  })

  it('still discards the one past it', () => {
    // Raising the bound moved it, it did not remove it. A redirect that never
    // came back is still reported as nothing at all.
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(STALE_AFTER_MS + 1))

    expect(readLastFlow()).toBeNull()
  })
})

// ── The 18 July sign-up, and why the comparison changed ─────────────────────
//
// A real sign-up came back badged 'ambiguous'. The diagnostic said why:
//
//   iat              1784416311   = 2026-07-18T23:11:51Z
//   createddatetime  "2026-07-18 23:16:43Z"
//   iat - created    = -292 seconds
//
// The token was dated nearly five minutes BEFORE the account it describes, so
// the old comparison hit its negative-age guard and refused to decide. `iat` in
// this tenant is not the minting moment. A tolerance big enough to cover a
// five-minute error is bigger than the flows being measured, so there was no
// version of that comparison worth keeping.
//
// This case is the whole reason the window exists, so it stays pinned here.
describe('the 18 July sign-up resolves, with iat as wrong as it ever was', () => {
  const IAT_SECONDS = 1_784_416_311
  const CREATED = '2026-07-18 23:16:43Z'
  const ELAPSED_MS = 46_500

  const token = tokenCreatedAt(CREATED, IAT_SECONDS)
  const createdAtMs = accountCreatedAtMs(token) as number
  const flow = matchFlow('default', ELAPSED_MS)

  it('still carries the iat that broke the old comparison', () => {
    // Pinned, so the case cannot quietly stop being the case it was recorded
    // as. If this line ever changes, the test below is testing something else.
    expect(createdAtMs).toBe(Date.parse('2026-07-18T23:16:43Z'))
    expect(IAT_SECONDS * 1000 - createdAtMs).toBe(-292_000)
  })

  it('resolves to signup', () => {
    // The window: a 46.5s round trip landing 4.4s after the account was created,
    // which is where captures/signup.json puts POST /common/createuser relative
    // to the browser coming back.
    const landedAt = createdAtMs + 4_400
    expect(resolveAmbiguous(flow, createdAtMs, token, landedAt)).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })

  it('resolves to signup on the other reading of that capture too', () => {
    // The HAR's last request is at 23:17:45Z, and the document lands before the
    // /token call that ends it. Anchoring the window at the very end of the HAR
    // instead puts the creation time 15.5s BEFORE the click rather than inside
    // the window, and the tolerance is what carries it.
    //
    // Both readings have to land on signup, because the flow was a sign-up
    // either way. Which anchor is right is what the diagnostic will settle on
    // the next real sign-up; the verdict must not wait on that.
    const landedAt = Date.parse('2026-07-18T23:17:45Z')
    expect(resolveAmbiguous(flow, createdAtMs, token, landedAt)).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })
})

describe('the branches that already knew are not up for revision', () => {
  // Each of these is deterministic or a bound, and a network answer arriving
  // late must not overwrite one. Returning the very same object is the check:
  // it proves the function did not so much as rebuild the match.
  // Deliberately a creation time that WOULD resolve to signup on the ambiguous
  // pair, so these prove the branch was skipped rather than that the input was
  // uninteresting.
  const CREATED = createdBeforeLanding(5_000)

  it('leaves prompt=login alone', () => {
    const match = matchFlow('force-credentials', 12_000)
    expect(resolve(CREATED, TOKEN, match)).toBe(match)
    expect(match).toMatchObject({ flow: 'sso-off' })
  })

  it('leaves the sign-out alone', () => {
    const match = matchFlow('sign-out', 900)
    expect(resolve(CREATED, TOKEN, match)).toBe(match)
    expect(match).toMatchObject({ flow: 'signout' })
  })

  it('leaves the sub-human-floor SSO bound alone', () => {
    const match = matchFlow('default', HUMAN_FLOOR_MS - 1)
    expect(resolve(CREATED, TOKEN, match)).toBe(match)
    expect(match).toMatchObject({ flow: 'sso-on' })
  })

  it('leaves nothing as nothing', () => {
    expect(resolve(CREATED, TOKEN, null)).toBeNull()
  })
})

describe('the settled answer replaces the frozen one, so a refresh keeps it', () => {
  beforeEach(() => clearLastFlow())

  it('writes the resolved flow back over the ambiguous one', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(20_000))
    expect(readLastFlow()).toMatchObject({ kind: 'ambiguous' })

    // settleLastFlow takes no window: it uses the real anchor, the same one
    // roundTripMs measured the seeded elapsed time against. So the creation time
    // has to be placed against that anchor too — five seconds before the browser
    // landed, inside the twenty-second window seeded above.
    const settled = settleLastFlow(performance.timeOrigin - 5_000, TOKEN)
    expect(settled).toMatchObject({ kind: 'matched', flow: 'signup' })
    // The badge has to survive a reload. Without the write-back it would appear
    // and then vanish on the next load, which reads as the page changing its
    // mind about what happened.
    expect(readLastFlow()).toMatchObject({ kind: 'matched', flow: 'signup' })
  })

  it('leaves storage untouched when there was nothing to settle', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(20_000))
    // Read once first: readLastFlow is what freezes the marker into a result,
    // so the "before" snapshot has to be taken after that has happened or it
    // compares against a slot nothing had written to yet.
    readLastFlow()
    const before = sessionStorage.getItem('tip.flow.result')
    expect(before).toContain('ambiguous')

    expect(settleLastFlow(null, TOKEN)).toMatchObject({ kind: 'ambiguous' })
    expect(sessionStorage.getItem('tip.flow.result')).toBe(before)
  })

  it('says nothing on a cold load, settled or not', () => {
    // Nobody has signed in. There is no flow to resolve and none gets invented.
    expect(settleLastFlow(performance.timeOrigin - 5_000, TOKEN)).toBeNull()
  })
})
