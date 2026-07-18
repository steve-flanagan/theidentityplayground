import { describe, expect, it } from 'vitest'
import { buildAuthRequest, isInteractionRequired } from './ssoRequest'

// Auth can't be exercised here — Entra sign-in fails in this environment with
// AADSTS50058 — so what IS testable is the thing that decides what goes on the
// wire. That matters more than it sounds: the last auth-adjacent change that
// shipped without a test broke every sign-in on the live site.

describe('the SSO demo is one request parameter', () => {
  it('sends no prompt by default, which is what lets the session be reused', () => {
    // The absence is the point. Sending prompt=select_account "to be explicit"
    // would silently defeat SSO and make the whole comparison meaningless.
    expect(buildAuthRequest('default').prompt).toBeUndefined()
  })

  it('sends prompt=login to defeat SSO on purpose', () => {
    expect(buildAuthRequest('force-credentials').prompt).toBe('login')
  })

  it('sends prompt=none for the silent probe', () => {
    expect(buildAuthRequest('silent').prompt).toBe('none')
  })

  it('keeps the configured scopes in every mode', () => {
    // A mode that quietly dropped scopes would change the token shape and make
    // the two captures incomparable, which is the entire point of the pair.
    for (const mode of ['default', 'force-credentials', 'silent'] as const) {
      expect(buildAuthRequest(mode).scopes).toEqual(['openid', 'profile', 'email'])
    }
  })

  it('never mutates the shared loginRequest', () => {
    buildAuthRequest('force-credentials')
    expect(buildAuthRequest('default').prompt).toBeUndefined()
  })
})

describe('a silent probe that fails for lack of a session is not an error', () => {
  it('recognises the codes that mean "no session, ask the user"', () => {
    for (const errorCode of [
      'login_required',
      'interaction_required',
      'consent_required',
      'silent_sso_error',
    ]) {
      expect(isInteractionRequired({ errorCode })).toBe(true)
    }
  })

  it('does not swallow a genuine failure', () => {
    expect(isInteractionRequired({ errorCode: 'invalid_request' })).toBe(false)
    expect(isInteractionRequired(new Error('network down'))).toBe(false)
    expect(isInteractionRequired(null)).toBe(false)
    expect(isInteractionRequired(undefined)).toBe(false)
  })
})
