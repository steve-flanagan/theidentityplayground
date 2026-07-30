// The one place that knows where the SCIM demo lives.
//
// Unlike APP2_PATH and GUEST_PATH, this string is duplicated across NOTHING.
// The page authenticates nobody, so there is no app registration and no redirect
// URI that has to match it character for character. Changing it breaks one link
// on the homepage and nothing in any tenant.
//
// public/staticwebapp.config.json needs no rule for it either: navigationFallback
// already rewrites any unmatched path to /index.html, so /scim is not a real file,
// falls through to the SPA, and main.tsx routes it. Same as /guest.

export const SCIM_PATH = '/scim'

/** Tolerant of a trailing slash, since a visitor may type either. */
export function isScimPath(pathname: string): boolean {
  return pathname === SCIM_PATH || pathname === `${SCIM_PATH}/`
}
