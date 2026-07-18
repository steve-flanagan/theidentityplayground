import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCOUNT_CREATED_CLAIM,
  HUMAN_FLOOR_MS,
  STALE_AFTER_MS,
  TOKEN_EXCHANGE_ALLOWANCE_MS,
  accountCreatedAtMs,
  clearLastFlow,
  markFlowStart,
  matchFlow,
  readLastFlow,
  resolveAmbiguous,
  settleLastFlow,
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
// Both timestamps come from Entra — `iat` and the creation time, stamped by the
// same authority. That is the point of the design, so the tests are written the
// same way: an `iat` is chosen, and the creation time is placed relative to it.

const ISSUED_AT_SECONDS = 1_800_000_000
const ISSUED_AT_MS = ISSUED_AT_SECONDS * 1000

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
/** Created this many ms before the token was issued. */
const createdBeforeIssue = (ms: number) => ISSUED_AT_MS - ms

describe('an account younger than the flow that produced it was created by it', () => {
  it('starts from a genuinely ambiguous match, or the rest proves nothing', () => {
    expect(INTERACTIVE).toMatchObject({ kind: 'ambiguous', elapsedMs: 20_000 })
  })

  it('calls it a sign-up when the account did not exist before the click', () => {
    // Created five seconds before the token was issued, inside a flow that took
    // twenty. It cannot have been there when the visitor clicked.
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(5_000), TOKEN)).toMatchObject({
      kind: 'matched',
      flow: 'signup',
    })
  })

  it('calls it a sign-in when the account was already there', () => {
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(3_600_000), TOKEN)).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })

  it('keeps the measured elapsed time, and does not invent a new one', () => {
    // The banner prints this number. Resolving WHICH flow it was must not touch
    // HOW LONG it took — that was measured, and nothing here re-measures it.
    const signedUp = resolveAmbiguous(INTERACTIVE, createdBeforeIssue(5_000), TOKEN)
    expect((signedUp as { elapsedMs: number }).elapsedMs).toBe(20_000)
  })

  it('puts the boundary at the end of the flow, plus the exchange it never saw', () => {
    // elapsedMs stops when the browser lands; the token is minted after that.
    // The allowance is that gap, and either side of it is a different answer.
    const edge = 20_000 + TOKEN_EXCHANGE_ALLOWANCE_MS
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(edge), TOKEN)).toMatchObject({
      flow: 'signup',
    })
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(edge + 1), TOKEN)).toMatchObject({
      flow: 'signin',
    })
  })
})

describe('no signal means no claim, which is exactly today’s behaviour', () => {
  it('stays ambiguous when Graph said nothing', () => {
    expect(resolveAmbiguous(INTERACTIVE, null, TOKEN)).toBe(INTERACTIVE)
  })

  it('stays ambiguous when there is no token to date the flow against', () => {
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(5_000), null)).toBe(INTERACTIVE)
  })

  it('stays ambiguous when the token is not a token', () => {
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(5_000), 'not-a-jwt')).toBe(INTERACTIVE)
  })

  it('stays ambiguous when the token carries no iat', () => {
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(5_000), tokenIssuedAt(undefined))).toBe(
      INTERACTIVE,
    )
    expect(resolveAmbiguous(INTERACTIVE, createdBeforeIssue(5_000), tokenIssuedAt('soon'))).toBe(
      INTERACTIVE,
    )
  })

  it('stays ambiguous when the numbers are garbage', () => {
    expect(resolveAmbiguous(INTERACTIVE, Number.NaN, TOKEN)).toBe(INTERACTIVE)
    expect(resolveAmbiguous(INTERACTIVE, Infinity, TOKEN)).toBe(INTERACTIVE)
  })

  it('stays ambiguous when the account is younger than its own token', () => {
    // Impossible, so a clock or a parse is wrong. Saying nothing beats guessing
    // which one, and a badge reading "you signed up" when they signed in is the
    // single worst thing this page can print.
    expect(resolveAmbiguous(INTERACTIVE, ISSUED_AT_MS + 1, TOKEN)).toBe(INTERACTIVE)
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
    expect(accountCreatedAtMs(tokenCreatedAt(ISSUED_AT_SECONDS))).toBe(ISSUED_AT_MS)
    expect(accountCreatedAtMs(tokenCreatedAt(ISSUED_AT_MS))).toBe(ISSUED_AT_MS)
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

  it('dates the sample account well before the token it sits in', () => {
    // The sample never reaches this reasoning in the app — only a real token
    // does. The coherence still has to hold, because a creation time seconds off
    // `iat` reads as an account that signed up during the flow on screen.
    const token = buildSampleToken()
    expect(resolveAmbiguous(INTERACTIVE, accountCreatedAtMs(token), token)).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })
})

// Steve's account was created on 16 July 2026 and he signs in on the 18th. It is
// two days older than any token it can issue, so every sign-in of his has to
// read as a sign-in. Sign-up is the case his own account cannot exercise: that
// needs an account created inside the flow being measured.
const STEVE_CREATED = '2026-07-16T19:32:51Z'
const STEVE_SIGNED_IN_AT = Math.floor(Date.parse('2026-07-18T14:05:00Z') / 1000)

describe('the flow is settled from the claim, end to end', () => {
  it('calls a two-day-old account signing in a sign-in', () => {
    const token = tokenCreatedAt(STEVE_CREATED, STEVE_SIGNED_IN_AT)
    expect(resolveAmbiguous(INTERACTIVE, accountCreatedAtMs(token), token)).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })

  it('calls an account created inside the flow a sign-up', () => {
    // The same path with five seconds of age instead of two days.
    const token = tokenCreatedAt(new Date(ISSUED_AT_MS - 5_000).toISOString())
    expect(resolveAmbiguous(INTERACTIVE, accountCreatedAtMs(token), token)).toMatchObject({
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
      expect(resolveAmbiguous(INTERACTIVE, accountCreatedAtMs(token), token)).toBe(INTERACTIVE)
    }
  })
})

describe('the branches that already knew are not up for revision', () => {
  // Each of these is deterministic or a bound, and a network answer arriving
  // late must not overwrite one. Returning the very same object is the check:
  // it proves the function did not so much as rebuild the match.
  const CREATED = createdBeforeIssue(5_000)

  it('leaves prompt=login alone', () => {
    const match = matchFlow('force-credentials', 12_000)
    expect(resolveAmbiguous(match, CREATED, TOKEN)).toBe(match)
    expect(match).toMatchObject({ flow: 'sso-off' })
  })

  it('leaves the sign-out alone', () => {
    const match = matchFlow('sign-out', 900)
    expect(resolveAmbiguous(match, CREATED, TOKEN)).toBe(match)
    expect(match).toMatchObject({ flow: 'signout' })
  })

  it('leaves the sub-human-floor SSO bound alone', () => {
    const match = matchFlow('default', HUMAN_FLOOR_MS - 1)
    expect(resolveAmbiguous(match, CREATED, TOKEN)).toBe(match)
    expect(match).toMatchObject({ flow: 'sso-on' })
  })

  it('leaves nothing as nothing', () => {
    expect(resolveAmbiguous(null, CREATED, TOKEN)).toBeNull()
  })
})

describe('the settled answer replaces the frozen one, so a refresh keeps it', () => {
  beforeEach(() => clearLastFlow())

  it('writes the resolved flow back over the ambiguous one', () => {
    markFlowStart('default')
    sessionStorage.setItem('tip.flow.start', startedBeforeLanding(20_000))
    expect(readLastFlow()).toMatchObject({ kind: 'ambiguous' })

    const settled = settleLastFlow(createdBeforeIssue(5_000), TOKEN)
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
    expect(settleLastFlow(createdBeforeIssue(5_000), TOKEN)).toBeNull()
  })
})
