// The one place that knows where the guest sign-up lives.
//
// Like APP2_PATH, this single string is duplicated across systems that cannot
// import from each other, so it is worth naming all of them:
//
//   1. HERE — the client-side route check in main.tsx.
//   2. The WORKFORCE app registration (1cb2c7c3, last-4 …262a), whose redirect
//      URI must be literally https://theidentityplayground.com/guest (and
//      http://localhost:5173/guest for local testing). Entra matches redirect
//      URIs by exact string; a trailing slash is a mismatch.
//   3. public/staticwebapp.config.json's navigationFallback already rewrites any
//      unmatched path to /index.html, so /guest needs NO new rule there: it is
//      not a real file, so it falls through to the SPA and main.tsx routes it.
//      (Contrast /blank.html, which that config excludes on purpose.)
//
// Change this string and (1) and (2) have to change together.

export const GUEST_PATH = '/guest'

/**
 * Is this pathname the guest sign-up page?
 *
 * Tolerant of a trailing slash on the way IN (a visitor may type either, a host
 * may normalise), but the redirect URI handed to Entra is always the canonical
 * no-slash form — see guestMsalConfig.
 */
export function isGuestPath(pathname: string): boolean {
  return pathname === GUEST_PATH || pathname === `${GUEST_PATH}/`
}
