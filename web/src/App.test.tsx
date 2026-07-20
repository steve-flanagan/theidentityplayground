import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { InteractionStatus, type AccountInfo } from '@azure/msal-browser'
import type { IMsalContext } from '@azure/msal-react'
import App from './App'
import {
  ACCOUNT_CREATED_CLAIM,
  accountCreatedAtMs,
  clearLastFlow,
  markFlowStart,
  readLastFlow,
  resolveAmbiguous,
  type FlowMatch,
} from './lib/lastFlow'

// The sample token exists so a signed-out visitor still sees a token. Its claim
// SET is real; its VALUES are invented, including createddatetime, which is
// dated months before the sample's own iat.
//
// resolveAmbiguous turns a creation time into a sign-up or sign-in BADGE. So the
// sample is one line of refactoring away from printing a badge for a flow nobody
// performed, off a number nobody measured — the exact fault this site is built
// not to commit. The barrier is that the effect in App reads `realIdToken` and
// nothing else, while the JSX beside it displays `realIdToken ?? sampleToken`.
// The two look interchangeable and are not.
//
// So: signed out, the timeline gets no resolved flow. Signed in, it does. Both
// halves are here, because a test that only asserts the null proves nothing
// about whether anything ran at all.

/**
 * Who MSAL says is signed in. Read at render time, not when the mock is built,
 * so a test can set it before mounting.
 */
let signedIn: AccountInfo[] = []

vi.mock('@azure/msal-react', () => ({
  // Only the three fields this tree touches. `instance` is never called during
  // a render — SignInPanel reaches for it inside click handlers, and nothing
  // here clicks — so an empty object is honest about what is exercised.
  useMsal: () =>
    ({
      accounts: signedIn,
      instance: {},
      inProgress: InteractionStatus.None,
    }) as unknown as IMsalContext,
  useIsAuthenticated: () => signedIn.length > 0,
}))

type TimelineProps = { token: string; resolvedFlow?: FlowMatch }

/** The props the timeline was last rendered with. */
let lastTimelineProps: TimelineProps | null = null

// Stubbed rather than rendered, for two reasons. The badge's only input from App
// is the `resolvedFlow` prop, and asserting on the prop keeps this test off the
// timeline's markup and its copy. What the timeline then DOES with a resolved
// flow is covered in JourneyTimeline.test.tsx, which is where it belongs.
vi.mock('./components/JourneyTimeline', () => ({
  JourneyTimeline: (props: TimelineProps) => {
    lastTimelineProps = props
    return null
  },
}))

function timeline(): TimelineProps {
  // Not defensive noise: if App stopped rendering the timeline, every assertion
  // below would otherwise pass by never happening.
  if (!lastTimelineProps) throw new Error('the timeline never rendered')
  return lastTimelineProps
}

const seg = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const ISSUED_AT_SECONDS = 1_800_000_000

/**
 * A token shaped like the one Entra issues here: an `iat`, and the mapped
 * creation claim.
 *
 * The creation time is placed against `performance.timeOrigin`, the anchor
 * seedAmbiguousFlow measures its round trip from, because that is what the
 * reasoning now compares it against: did the account appear inside the window
 * the flow ran in. It used to be placed against `iat`, and a real sign-up
 * turned that premise over — see resolveAmbiguous.
 *
 * `iat` is left exactly where it was, which puts it months away from the
 * creation time. That is the point: the decision does not read it.
 */
function realToken(createdSecondsBeforeLanding: number): string {
  const created = new Date(
    performance.timeOrigin - createdSecondsBeforeLanding * 1000,
  ).toISOString()
  const payload = { iat: ISSUED_AT_SECONDS, [ACCOUNT_CREATED_CLAIM]: created }
  return `${seg({ typ: 'JWT', alg: 'RS256' })}.${seg(payload)}.NOT_A_SIGNATURE`
}

/** Enough of an AccountInfo for `accounts[0].idToken`, which is all App reads. */
function accountHolding(idToken: string): AccountInfo {
  return {
    homeAccountId: 'home-account-id',
    environment: 'theidentityplayground.ciamlogin.com',
    tenantId: '7e8da8a9-67bc-4d53-bfc7-fe3e13128382',
    username: 'demo@theidentityplayground.com',
    localAccountId: 'local-account-id',
    idToken,
  }
}

/**
 * The one state a badge can come out of: a round trip long enough that a human
 * must have been typing, which matchFlow refuses to name. Anything else is
 * already decided and resolveAmbiguous will not touch it.
 */
function seedAmbiguousFlow() {
  markFlowStart('default')
  // Same anchor as lastFlow.test.ts: a start stamp N ms before this document's
  // navigation began is an elapsed time of exactly N.
  sessionStorage.setItem('tip.flow.start', String(performance.timeOrigin - 20_000))
}

beforeEach(() => {
  signedIn = []
  lastTimelineProps = null
  clearLastFlow()
})
afterEach(cleanup)

describe('a signed-out visitor is never badged with a flow that never happened', () => {
  it('gives the timeline no resolved flow, and leaves the answer ambiguous', () => {
    seedAmbiguousFlow()

    render(<App />)

    // The badge's input, and the frozen answer a refresh would read back. A
    // sign-up or sign-in in either place is a claim about a visitor who has not
    // signed in.
    expect(timeline().resolvedFlow ?? null).toBeNull()
    expect(readLastFlow()).toMatchObject({ kind: 'ambiguous' })
  })

  it('is holding a sample that WOULD resolve, which is the whole hazard', () => {
    seedAmbiguousFlow()

    render(<App />)

    // The very token App handed the timeline for display, run through the
    // reasoning it is kept away from. It resolves — confidently, and to a flow
    // nobody performed. That is why the null above is load-bearing rather than
    // an accident of the sample being inert.
    const sample = timeline().token
    expect(accountCreatedAtMs(sample)).not.toBeNull()
    expect(resolveAmbiguous(readLastFlow(), accountCreatedAtMs(sample), sample)).toMatchObject({
      kind: 'matched',
      flow: 'signin',
    })
  })

  it('does badge the flow once a real token is there to date it against', () => {
    // The control. Without it the assertions above could pass on an App that
    // never resolves anything for anyone.
    seedAmbiguousFlow()
    signedIn = [accountHolding(realToken(5))]

    render(<App />)

    expect(timeline().resolvedFlow).toMatchObject({ kind: 'matched', flow: 'signup' })
  })
})
