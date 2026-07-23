// The guest token, handed from /guest back to the main page.
//
// ── Why a hand-off at all, and not just MSAL ────────────────────────────────
//
// The main page's MSAL instance is the CIAM client. MSAL keys TOKENS per client
// (msal.<v>.token.keys.<clientId> — see app2MsalConfig), so the CIAM instance
// cannot read a token minted for the workforce client no matter that the two
// share an origin. So /guest passes the raw ID token across in a key of ours,
// and the main page reads it into "guest mode": the inspector and Module 2 show
// the real guest, exactly as the member sample does but with a live token
// instead of a baked one.
//
// sessionStorage, not localStorage: it dies with the tab, the same as every
// token on this site, and it is scoped to the origin so /guest and / share it.
// It only ever holds the visitor's OWN guest token, in their OWN browser.

import { decodeJwt } from '../lib/jwt'

const GUEST_TOKEN_KEY = 'tip.guest.idtoken'

export function storeGuestToken(idToken: string): void {
  try {
    window.sessionStorage.setItem(GUEST_TOKEN_KEY, idToken)
  } catch {
    // sessionStorage can throw when disabled or sandboxed. Nothing to do but let
    // the hand-off fail quietly; /guest still completed the sign-in.
  }
}

export function readGuestToken(): string | null {
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(GUEST_TOKEN_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  // Only hand back a token that still decodes and has not expired. A value that
  // will not decode would throw when the timeline builds its token subtree
  // (buildTokenNode does not guard decodeJwt), white-screening the page; an
  // expired one would render as "live" for the tab's lifetime, which is the wrong
  // tell on a site about telling the truth about tokens. Both only arise from a
  // tampered or stale key, and the guard costs one decode.
  try {
    const { payload } = decodeJwt(raw)
    const exp = (payload as { exp?: unknown }).exp
    if (typeof exp === 'number' && exp * 1000 <= Date.now()) {
      clearGuestToken()
      return null
    }
    return raw
  } catch {
    clearGuestToken()
    return null
  }
}

export function clearGuestToken(): void {
  try {
    window.sessionStorage.removeItem(GUEST_TOKEN_KEY)
  } catch {
    // A storage that cannot be read cannot be stranding anything either.
  }
}
