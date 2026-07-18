import { describe, expect, it, vi } from 'vitest'
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser'
import {
  acquireHeldToken,
  buildHeldTokenRequest,
  holdsTokenForThisApp,
  pickAccount,
} from './heldToken'
import {
  APP2_CLIENT_ID,
  MAIN_CLIENT_ID_FOR_DISPLAY,
  crossAppSsoRequest,
} from '../auth/app2MsalConfig'

// A real silent acquisition cannot run here: Entra sign-in fails in this
// environment with AADSTS50058, so there is no session and no cache to hit.
// MSAL is therefore mocked, and what is under test is the DECISION the button
// makes from MSAL's answer. Nothing below proves anything about Entra.
//
// TWO bugs are fenced off here, and they pull in opposite directions.
//
//   1. The button called loginRedirect unconditionally, so a press with a
//      perfectly good token in hand still went to Entra.
//   2. The fix for (1) gated on having an ACCOUNT. Accounts are cached per
//      ORIGIN and shared across client IDs, so the main app's account made this
//      app attempt a silent call it could not possibly win. Measured in a HAR:
//      login_required in 231 ms, then ten seconds of MSAL's iframe timeout,
//      then the redirect that was always the answer.
//
// So a token in hand must not redirect, and an empty hand must not go silent
// first. The assertions that `acquireTokenSilent` was NOT called are the point
// of the second half, not incidental detail.

/** base64url, the JWT alphabet. Not the same as base64 — see lib/jwt. */
function b64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A decodable ID token carrying one claim that matters here.
 *
 * Unsigned and unverifiable, which is fine: nothing in this path checks a
 * signature, and lib/jwt is explicit that it is a viewer and not a validator.
 */
function tokenFor(audience: string): string {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ aud: audience })}.not-a-signature`
}

function bareAccount(username: string, idToken?: string): AccountInfo {
  return {
    homeAccountId: 'home-account-id',
    environment: 'theidentityplayground.ciamlogin.com',
    tenantId: '7e8da8a9-67bc-4d53-bfc7-fe3e13128382',
    username,
    localAccountId: 'local-account-id',
    idToken,
  }
}

/**
 * The ordinary case: an account this client has already been issued a token
 * for. MSAL hydrates `idToken` from a cache filtered by the instance's own
 * client ID, so in app2's instance a populated field means an app2 token.
 */
function fakeAccount(username = 'demo@theidentityplayground.com'): AccountInfo {
  return bareAccount(username, tokenFor(APP2_CLIENT_ID))
}

/**
 * What the main app leaves behind on this origin: a known user, and nothing
 * issued to this client ID. The exact state that cost ten seconds.
 */
function accountWithoutToken(username = 'signed-into-app1@example.com'): AccountInfo {
  return bareAccount(username)
}

/** Only the three methods the module touches. Everything else would be noise. */
function fakeInstance(options: {
  activeAccount?: AccountInfo | null
  allAccounts?: AccountInfo[]
  silent?: () => Promise<AuthenticationResult>
}) {
  return {
    getActiveAccount: () => options.activeAccount ?? null,
    getAllAccounts: () => options.allAccounts ?? [],
    acquireTokenSilent: vi.fn(options.silent ?? (() => Promise.reject(new Error('not stubbed')))),
  }
}

/** Enough of an AuthenticationResult for this module. It reads two fields. */
function silentResult(idToken: string, fromCache: boolean): AuthenticationResult {
  return { idToken, fromCache } as AuthenticationResult
}

describe('the silent request is the redirect request plus an account', () => {
  it('asks for the same scopes the redirect asks for', () => {
    // Not a style point. MSAL keys its cache lookup by scope, so a silent call
    // asking for a different set than the redirect cached would miss and go to
    // the network for a token already sitting in the browser.
    expect(buildHeldTokenRequest(fakeAccount()).scopes).toEqual(crossAppSsoRequest.scopes)
    expect(buildHeldTokenRequest(fakeAccount()).scopes).toEqual(['openid', 'profile', 'email'])
  })

  it('carries the account, which is what the token lookup is keyed against', () => {
    const account = fakeAccount()
    expect(buildHeldTokenRequest(account).account).toBe(account)
  })

  it('sends no prompt, for the same reason the redirect sends none', () => {
    expect(buildHeldTokenRequest(fakeAccount()).prompt).toBeUndefined()
  })

  it('points the iframe leg at blank.html rather than the app', () => {
    // Only leg (3) reads this. Unset, the hidden iframe loads the whole SPA and
    // the parent times out waiting for a fragment, reported as `timed_out`.
    // Origin comes from jsdom here; what matters is the path it lands on.
    expect(buildHeldTokenRequest(fakeAccount()).redirectUri).toMatch(/\/blank\.html$/)
    expect(buildHeldTokenRequest(fakeAccount()).redirectUri).toBe(
      `${window.location.origin}/blank.html`,
    )
  })
})

describe('which account the lookup runs against', () => {
  it('prefers the active account, which is this client id own', () => {
    const active = fakeAccount('active@example.com')
    const shared = fakeAccount('shared@example.com')
    expect(pickAccount(fakeInstance({ activeAccount: active, allAccounts: [shared] }))).toBe(active)
  })

  it('falls back to the shared per-origin cache when this app has set none', () => {
    const shared = fakeAccount('shared@example.com')
    expect(pickAccount(fakeInstance({ allAccounts: [shared] }))).toBe(shared)
  })

  it('reports nothing rather than an empty stand-in when the origin knows no one', () => {
    expect(pickAccount(fakeInstance({}))).toBeNull()
  })
})

describe('an account is not a token, and the difference is the whole fix', () => {
  it('accepts a token addressed to this client id', () => {
    expect(holdsTokenForThisApp(bareAccount('demo', tokenFor(APP2_CLIENT_ID)))).toBe(true)
  })

  it('rejects the main app token, which is what the shared cache offers up', () => {
    // Defensive rather than expected: MSAL filters `idToken` by client ID, so
    // this should not be reachable. It is checked because the cost of being
    // wrong is this app presenting another app's token as its own.
    expect(holdsTokenForThisApp(bareAccount('demo', tokenFor(MAIN_CLIENT_ID_FOR_DISPLAY)))).toBe(
      false,
    )
  })

  it('rejects an account carrying no token at all', () => {
    expect(holdsTokenForThisApp(accountWithoutToken())).toBe(false)
  })

  it('rejects an unreadable token instead of throwing on it', () => {
    expect(holdsTokenForThisApp(bareAccount('demo', 'not.a.jwt'))).toBe(false)
    expect(holdsTokenForThisApp(bareAccount('demo', ''))).toBe(false)
  })

  it('rejects a well-formed token that carries no audience claim', () => {
    const noAud = `${b64url({ alg: 'RS256' })}.${b64url({ sub: 'nobody' })}.sig`
    expect(holdsTokenForThisApp(bareAccount('demo', noAud))).toBe(false)
  })
})

describe('a token already in hand does not go back to Entra', () => {
  it('shows the cached token, and says it came from the cache', async () => {
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => Promise.resolve(silentResult('cached.id.token', true)),
    })

    const outcome = await acquireHeldToken(instance)

    expect(outcome).toEqual({ kind: 'cache', idToken: 'cached.id.token' })
    // The whole defect in one assertion: this press must not be a redirect.
    expect(outcome.kind).not.toBe('redirect')
  })

  it('passes the account and the configured scopes to MSAL', async () => {
    const account = fakeAccount()
    const instance = fakeInstance({
      activeAccount: account,
      silent: () => Promise.resolve(silentResult('cached.id.token', true)),
    })

    await acquireHeldToken(instance)

    expect(instance.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: crossAppSsoRequest.scopes,
      account,
      redirectUri: `${window.location.origin}/blank.html`,
    })
  })

  it('separates a renewal from a cache hit using MSAL own fromCache flag', async () => {
    // fromCache=false means MSAL went to the network and still came back
    // without interaction. The page is allowed to say the token is new; it is
    // not allowed to say which leg served it, so this only records the split.
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => Promise.resolve(silentResult('renewed.id.token', false)),
    })

    expect(await acquireHeldToken(instance)).toEqual({
      kind: 'renewed',
      idToken: 'renewed.id.token',
    })
  })
})

describe('a silent call is only made when it can succeed', () => {
  // MSAL cannot fail a doomed silent call quickly. Legs (1) and (2) miss, and
  // leg (3) is a hidden iframe Entra refuses for want of a partitioned session
  // cookie — after which MSAL waits out its own iframe timeout. That timeout is
  // the ten seconds. The only way not to pay it is not to start.

  it('goes silent when this client holds a token for its own audience', async () => {
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => Promise.resolve(silentResult('cached.id.token', true)),
    })

    expect(await acquireHeldToken(instance)).toEqual({ kind: 'cache', idToken: 'cached.id.token' })
    expect(instance.acquireTokenSilent).toHaveBeenCalledTimes(1)
  })

  it('never goes silent on a foreign account, and redirects instead', async () => {
    // The reported failure, exactly: signed into the main app, first press on
    // this page. An account is visible here, a token for this client is not.
    const instance = fakeInstance({ allAccounts: [accountWithoutToken()] })

    expect(await acquireHeldToken(instance)).toEqual({
      kind: 'redirect',
      reason: 'no-token-for-this-app',
      message: null,
    })
    expect(instance.acquireTokenSilent).not.toHaveBeenCalled()
  })

  it('never goes silent on a token addressed to another client id', async () => {
    const instance = fakeInstance({
      allAccounts: [bareAccount('demo', tokenFor(MAIN_CLIENT_ID_FOR_DISPLAY))],
    })

    expect(await acquireHeldToken(instance)).toEqual({
      kind: 'redirect',
      reason: 'no-token-for-this-app',
      message: null,
    })
    expect(instance.acquireTokenSilent).not.toHaveBeenCalled()
  })

  it('never goes silent on an unreadable token, and does not throw on one', async () => {
    const instance = fakeInstance({ activeAccount: bareAccount('demo', 'garbage') })

    await expect(acquireHeldToken(instance)).resolves.toEqual({
      kind: 'redirect',
      reason: 'no-token-for-this-app',
      message: null,
    })
    expect(instance.acquireTokenSilent).not.toHaveBeenCalled()
  })

  it('separates never-tried from tried-and-lost', async () => {
    // Both end at the same redirect, so a boolean would have served the caller.
    // They are kept apart because they are different facts about MSAL, and
    // collapsing them is how the ten-second call looked reasonable in the first
    // place: 'interaction-required' means a silent call ran and failed.
    const untried = fakeInstance({ allAccounts: [accountWithoutToken()] })
    const tried = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () =>
        Promise.reject(
          new InteractionRequiredAuthError('login_required', 'correlation-id', 'no session'),
        ),
    })

    const untriedOutcome = await acquireHeldToken(untried)
    const triedOutcome = await acquireHeldToken(tried)

    expect(untriedOutcome.kind).toBe('redirect')
    expect(triedOutcome.kind).toBe('redirect')
    expect(untriedOutcome).not.toEqual(triedOutcome)
    expect(untried.acquireTokenSilent).not.toHaveBeenCalled()
    expect(tried.acquireTokenSilent).toHaveBeenCalledTimes(1)
  })
})

describe('a redirect happens when, and only when, there is nothing to show', () => {
  it('goes straight to the redirect when the origin holds no account at all', async () => {
    const instance = fakeInstance({})

    expect(await acquireHeldToken(instance)).toEqual({
      kind: 'redirect',
      reason: 'no-account',
      message: null,
    })
    // Nothing to look up, so nothing was looked up.
    expect(instance.acquireTokenSilent).not.toHaveBeenCalled()
  })

  it('falls through to the redirect on InteractionRequiredAuthError', async () => {
    // The designed failure. Cache empty, refresh token gone or rejected, and
    // the iframe leg blocked by third-party cookie partitioning. Interactive
    // sign-in is the correct answer and this is how MSAL asks for it.
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () =>
        Promise.reject(
          new InteractionRequiredAuthError('login_required', 'correlation-id', 'no session'),
        ),
    })

    expect(await acquireHeldToken(instance)).toEqual({
      kind: 'redirect',
      reason: 'interaction-required',
      message: null,
    })
  })

  it('does not file a genuine failure under the same reason', async () => {
    // A network fault is not "please sign in". Both end at the redirect, since
    // a button that does nothing is worse than one that costs a round trip, but
    // the message has to survive rather than be dressed up as the normal path.
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => Promise.reject(new Error('network down')),
    })

    const outcome = await acquireHeldToken(instance)

    expect(outcome.kind).toBe('redirect')
    expect(outcome).toEqual({ kind: 'redirect', reason: 'unexpected', message: 'network down' })
  })

  it('keeps a thrown non-Error readable instead of dropping it', async () => {
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => Promise.reject('something threw a string'),
    })

    const outcome = await acquireHeldToken(instance)

    expect(outcome).toEqual({
      kind: 'redirect',
      reason: 'unexpected',
      message: 'something threw a string',
    })
  })

  it('refuses a silent success that carries no ID token', async () => {
    // Would otherwise leave the page believing it holds a token and rendering
    // an empty claims table. A redirect is the honest way out.
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => Promise.resolve(silentResult('', true)),
    })

    const outcome = await acquireHeldToken(instance)

    expect(outcome.kind).toBe('redirect')
    expect(outcome.kind).not.toBe('cache')
  })

  it('never throws, whatever MSAL does, so the caller always has a next move', async () => {
    const instance = fakeInstance({
      activeAccount: fakeAccount(),
      silent: () => {
        throw new Error('thrown synchronously')
      },
    })

    await expect(acquireHeldToken(instance)).resolves.toMatchObject({ kind: 'redirect' })
  })
})
