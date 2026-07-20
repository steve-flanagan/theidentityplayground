import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { AccountInfo, AuthenticationResult } from '@azure/msal-browser'
import { completeRedirect, isAuthResponseInFragment, type RedirectBootInstance } from './redirectBoot'

/**
 * What is and is not covered here.
 *
 * `main.tsx` boots at import: it constructs a PublicClientApplication and calls
 * createRoot at module scope, so importing it in a test would run the real boot
 * and mount the whole app. That is why the decision lives in redirectBoot.ts and
 * this file tests it directly. The three lines added to main.tsx (the import,
 * the awaited call, the try/catch around it) are not executed by any test here.
 *
 * What genuinely cannot be tested from here, and is stated rather than faked:
 * that a REAL msal-browser instance returns the memoized promise to
 * MsalProvider's second call. That was verified by reading
 * StandardController.mjs, not by running it. A fake instance proves nothing
 * about MSAL's own memoization.
 */

/** A stand-in for PublicClientApplication, with the calls recorded. */
type FakeInstance = RedirectBootInstance & {
  clearCache: Mock<() => Promise<void>>
  setActiveAccount: Mock<(account: AccountInfo | null) => void>
}

function fakeInstance(
  handleRedirectPromise: () => Promise<AuthenticationResult | null>,
): FakeInstance {
  return {
    handleRedirectPromise,
    clearCache: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setActiveAccount: vi.fn<(account: AccountInfo | null) => void>(),
  }
}

/** Enough of an AuthenticationResult to stand for "a response was redeemed". */
const A_RESULT = { idToken: 'header.payload.signature' } as AuthenticationResult

/** The three keys lastFlow.ts writes, so the test asserts real storage. */
const INTENT_KEY = 'tip.flow.intent'
const START_KEY = 'tip.flow.start'
const RESULT_KEY = 'tip.flow.result'

function stampAFlowStart(): void {
  sessionStorage.setItem(INTENT_KEY, 'default')
  sessionStorage.setItem(START_KEY, String(Date.now()))
  sessionStorage.setItem(RESULT_KEY, '{"kind":"ambiguous","elapsedMs":1}')
}

function flowMarkersPresent(): boolean {
  return (
    sessionStorage.getItem(INTENT_KEY) !== null ||
    sessionStorage.getItem(START_KEY) !== null ||
    sessionStorage.getItem(RESULT_KEY) !== null
  )
}

describe('isAuthResponseInFragment', () => {
  it('finds a code or an error wherever it sits in the fragment', () => {
    expect(isAuthResponseInFragment('#code=abc')).toBe(true)
    expect(isAuthResponseInFragment('#state=xyz&code=abc')).toBe(true)
    expect(isAuthResponseInFragment('#error=access_denied')).toBe(true)
    expect(isAuthResponseInFragment('#state=xyz&error=access_denied')).toBe(true)
  })

  it('does not fire on an empty or unrelated fragment', () => {
    expect(isAuthResponseInFragment('')).toBe(false)
    expect(isAuthResponseInFragment('#')).toBe(false)
    expect(isAuthResponseInFragment('#/some/route')).toBe(false)
    expect(isAuthResponseInFragment('#section-2')).toBe(false)
  })

  it('does not match a parameter that merely ends in code or error', () => {
    // `postal_code=` and `last_error=` are not authorization responses, and
    // treating them as one would clear a working session.
    expect(isAuthResponseInFragment('#postal_code=90210')).toBe(false)
    expect(isAuthResponseInFragment('#last_error=none')).toBe(false)
  })
})

describe('completeRedirect', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── The success path must be untouched ──────────────────────────────────────

  it('reports a redeemed response and clears nothing', async () => {
    stampAFlowStart()
    const instance = fakeInstance(async () => A_RESULT)

    const outcome = await completeRedirect(instance, () => '#code=abc')

    expect(outcome).toBe('redeemed')
    expect(instance.clearCache).not.toHaveBeenCalled()
    expect(instance.setActiveAccount).not.toHaveBeenCalled()
    // The flow marker is what the timeline measures the round trip from. A
    // successful sign-in must arrive with it intact.
    expect(flowMarkersPresent()).toBe(true)
  })

  it('treats an ordinary page load as nothing to do', async () => {
    stampAFlowStart()
    const instance = fakeInstance(async () => null)

    const outcome = await completeRedirect(instance, () => '')

    expect(outcome).toBe('nothing-to-redeem')
    expect(instance.clearCache).not.toHaveBeenCalled()
    expect(flowMarkersPresent()).toBe(true)
  })

  it('leaves a session alone when the fragment is not an auth response', async () => {
    const instance = fakeInstance(async () => null)

    const outcome = await completeRedirect(instance, () => '#pricing')

    expect(outcome).toBe('nothing-to-redeem')
    expect(instance.clearCache).not.toHaveBeenCalled()
  })

  // ── The measured bug: null, with a code still in the fragment ───────────────

  it('recovers when a code is left unredeemed in the fragment', async () => {
    stampAFlowStart()
    const instance = fakeInstance(async () => null)

    const outcome = await completeRedirect(instance, () => '#code=abc&state=xyz')

    expect(outcome).toBe('recovered')
    expect(instance.clearCache).toHaveBeenCalledTimes(1)
    expect(instance.setActiveAccount).toHaveBeenCalledWith(null)
    // A start stamp for a redirect that never finished would otherwise become a
    // measured round trip on the next plain load.
    expect(flowMarkersPresent()).toBe(false)
  })

  it('recovers when Entra returned an error in the fragment', async () => {
    const instance = fakeInstance(async () => null)

    const outcome = await completeRedirect(instance, () => '#error=access_denied')

    expect(outcome).toBe('recovered')
    expect(instance.clearCache).toHaveBeenCalledTimes(1)
  })

  // ── A rejection must never stop the app booting ─────────────────────────────

  it('recovers from a rejecting handleRedirectPromise and does not throw', async () => {
    stampAFlowStart()
    const instance = fakeInstance(async () => {
      throw new Error('AADSTS50011: redirect URI mismatch')
    })

    const outcome = await completeRedirect(instance, () => '')

    expect(outcome).toBe('recovered')
    expect(instance.clearCache).toHaveBeenCalledTimes(1)
    expect(instance.setActiveAccount).toHaveBeenCalledWith(null)
    expect(flowMarkersPresent()).toBe(false)
  })

  it('resolves rather than throwing when recovery itself fails', async () => {
    // The worst case: the response could not be read AND the state could not be
    // dropped. main.tsx still has to reach createRoot.
    const instance = fakeInstance(async () => {
      throw new Error('unreadable request cache')
    })
    instance.clearCache.mockRejectedValue(new Error('storage is gone'))

    const outcome = await completeRedirect(instance, () => '')

    expect(outcome).toBe('stuck')
    expect(instance.setActiveAccount).not.toHaveBeenCalled()
  })

  it('resolves when handleRedirectPromise rejects with something that is not an Error', async () => {
    const instance = fakeInstance(async () => {
      throw 'a bare string'
    })

    await expect(completeRedirect(instance, () => '')).resolves.toBe('recovered')
  })

  // ── Ordering: the fragment gets its chance first ────────────────────────────

  it('clears nothing until handleRedirectPromise has settled', async () => {
    // Wiping the cache while the response is still in flight destroys the PKCE
    // verifier and state the code is redeemed against. That IS the failure being
    // fixed, so the ordering is asserted rather than assumed.
    let settle: (value: AuthenticationResult | null) => void = () => {}
    const pending = new Promise<AuthenticationResult | null>((resolve) => {
      settle = resolve
    })

    const instance = fakeInstance(() => pending)
    const inFlight = completeRedirect(instance, () => '#code=abc')

    // Let the microtask queue drain while handleRedirectPromise is still open.
    await Promise.resolve()
    await Promise.resolve()

    expect(instance.clearCache).not.toHaveBeenCalled()
    expect(instance.setActiveAccount).not.toHaveBeenCalled()

    settle(null)
    await expect(inFlight).resolves.toBe('recovered')
    expect(instance.clearCache).toHaveBeenCalledTimes(1)
  })

  it('reads the fragment only after handleRedirectPromise has settled', async () => {
    // MSAL clears the hash itself the moment it recognises a response
    // (RedirectClient.getRedirectResponse), so reading it early would see a code
    // that MSAL is in the middle of redeeming and call a working sign-in broken.
    const order: string[] = []
    const instance = fakeInstance(async () => {
      order.push('handleRedirectPromise')
      return null
    })

    await completeRedirect(instance, () => {
      order.push('readHash')
      return ''
    })

    expect(order).toEqual(['handleRedirectPromise', 'readHash'])
  })

  it('calls handleRedirectPromise exactly once', async () => {
    // The second call belongs to MsalProvider, against the real instance, where
    // MSAL's own memoization returns this same promise. Nothing here should be
    // adding a third.
    const handle = vi.fn().mockResolvedValue(null)
    const instance = fakeInstance(handle)

    await completeRedirect(instance, () => '')

    expect(handle).toHaveBeenCalledTimes(1)
  })
})
