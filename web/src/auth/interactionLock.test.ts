import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearForeignInteractionLock, shouldClearInteractionLock } from './interactionLock'

// Auth cannot be exercised here — Entra sign-in fails in this environment with
// AADSTS50058 — so what IS testable is the decision: given a stored lock value
// and the client ID that is booting, do we clear it? That decision is the only
// risky part of the fix, and the last auth change that shipped without a test
// broke every sign-in on the live site.

const MAIN_CLIENT = 'e891bf4d-ab35-4686-81b9-a973001b378f'
const APP2_CLIENT = '0951090a-650a-4d43-9f81-b9195866fc6c'
const KEY = 'msal.interaction.status'

/** The exact value read out of Steve's browser while he was locked out. */
const STUCK_VALUE = JSON.stringify({ clientId: APP2_CLIENT, type: 'signin' })

describe('a lock belonging to our own client is NEVER cleared', () => {
  // This is the safety property. Getting it wrong breaks every sign-in, which
  // is the exact failure this whole change is trying to avoid. It is asserted
  // first and from several angles on purpose.

  it('leaves the main app its own signin lock', () => {
    const own = JSON.stringify({ clientId: MAIN_CLIENT, type: 'signin' })
    expect(shouldClearInteractionLock(own, MAIN_CLIENT)).toBe(false)
  })

  it('leaves the main app its own signout lock', () => {
    const own = JSON.stringify({ clientId: MAIN_CLIENT, type: 'signout' })
    expect(shouldClearInteractionLock(own, MAIN_CLIENT)).toBe(false)
  })

  it('leaves app2 its own lock', () => {
    expect(shouldClearInteractionLock(STUCK_VALUE, APP2_CLIENT)).toBe(false)
  })

  it('matches on the client ID and nothing else', () => {
    // Extra fields, different key order, whitespace: none of it changes the
    // answer. Only the clientId comparison decides.
    const own = '{ "type": "signin", "clientId": "' + MAIN_CLIENT + '", "extra": 1 }'
    expect(shouldClearInteractionLock(own, MAIN_CLIENT)).toBe(false)
  })

  it('is case sensitive, so a differently cased GUID is treated as foreign', () => {
    // Documenting real behaviour rather than asserting a preference. MSAL's own
    // check is `clientId === this.clientId`, so this mirrors it. Both configs
    // hold lowercase literals, so this cannot arise in practice.
    const upper = JSON.stringify({ clientId: MAIN_CLIENT.toUpperCase(), type: 'signin' })
    expect(shouldClearInteractionLock(upper, MAIN_CLIENT)).toBe(true)
  })
})

describe('a lock belonging to a different client is cleared', () => {
  it('clears the app2 lock that blocked the main app', () => {
    // The actual reported failure: app2's lock, main app booting.
    expect(shouldClearInteractionLock(STUCK_VALUE, MAIN_CLIENT)).toBe(true)
  })

  it('works symmetrically, so the main app cannot strand app2 either', () => {
    const mainLock = JSON.stringify({ clientId: MAIN_CLIENT, type: 'signout' })
    expect(shouldClearInteractionLock(mainLock, APP2_CLIENT)).toBe(true)
  })
})

describe('anything unreadable is left alone and never throws', () => {
  it('is a no-op when the key is absent', () => {
    expect(shouldClearInteractionLock(null, MAIN_CLIENT)).toBe(false)
    expect(shouldClearInteractionLock(undefined, MAIN_CLIENT)).toBe(false)
  })

  it('is a no-op on an empty string', () => {
    expect(shouldClearInteractionLock('', MAIN_CLIENT)).toBe(false)
  })

  it('is a no-op on malformed JSON, and does not throw', () => {
    for (const malformed of ['{', 'not json at all', '{"clientId":', '{"clientId":"x"']) {
      expect(() => shouldClearInteractionLock(malformed, MAIN_CLIENT)).not.toThrow()
      expect(shouldClearInteractionLock(malformed, MAIN_CLIENT)).toBe(false)
    }
  })

  it('is a no-op on valid JSON with no clientId field', () => {
    expect(shouldClearInteractionLock('{}', MAIN_CLIENT)).toBe(false)
    expect(shouldClearInteractionLock('{"type":"signin"}', MAIN_CLIENT)).toBe(false)
  })

  it('is a no-op on valid JSON that is not an object', () => {
    // JSON.parse returns these happily. None of them can carry a clientId.
    for (const value of ['null', '5', '"a string"', '[]', 'true']) {
      expect(shouldClearInteractionLock(value, MAIN_CLIENT)).toBe(false)
    }
  })

  it('is a no-op when clientId is present but not a usable string', () => {
    expect(shouldClearInteractionLock('{"clientId":null}', MAIN_CLIENT)).toBe(false)
    expect(shouldClearInteractionLock('{"clientId":""}', MAIN_CLIENT)).toBe(false)
    expect(shouldClearInteractionLock('{"clientId":123}', MAIN_CLIENT)).toBe(false)
    expect(shouldClearInteractionLock('{"clientId":{}}', MAIN_CLIENT)).toBe(false)
  })
})

describe('the storage sweep touches only the one key, and only when it should', () => {
  // jsdom gives us a real sessionStorage, so the side-effecting half is
  // testable too. The key name is asserted here rather than imported, so a
  // typo in the literal inside interactionLock.ts would fail this suite.

  beforeEach(() => {
    window.sessionStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('removes a foreign lock from the key MSAL actually writes', () => {
    window.sessionStorage.setItem(KEY, STUCK_VALUE)

    expect(clearForeignInteractionLock(MAIN_CLIENT)).toBe(true)
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('leaves our own lock in storage, untouched', () => {
    const own = JSON.stringify({ clientId: MAIN_CLIENT, type: 'signin' })
    window.sessionStorage.setItem(KEY, own)

    expect(clearForeignInteractionLock(MAIN_CLIENT)).toBe(false)
    expect(window.sessionStorage.getItem(KEY)).toBe(own)
  })

  it('leaves every other MSAL key alone when it does clear', () => {
    // Token and request keys are namespaced per client, so a lock sweep has no
    // business removing them.
    window.sessionStorage.setItem(KEY, STUCK_VALUE)
    window.sessionStorage.setItem(`msal.token.keys.${MAIN_CLIENT}`, '{"idToken":[]}')
    window.sessionStorage.setItem('msal.3.account.keys', '[]')

    clearForeignInteractionLock(MAIN_CLIENT)

    expect(window.sessionStorage.getItem(`msal.token.keys.${MAIN_CLIENT}`)).toBe('{"idToken":[]}')
    expect(window.sessionStorage.getItem('msal.3.account.keys')).toBe('[]')
  })

  it('is a no-op when nothing is stored', () => {
    expect(clearForeignInteractionLock(MAIN_CLIENT)).toBe(false)
  })

  it('does not throw when sessionStorage itself is unavailable', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(() => clearForeignInteractionLock(MAIN_CLIENT)).not.toThrow()
    expect(clearForeignInteractionLock(MAIN_CLIENT)).toBe(false)
  })
})
