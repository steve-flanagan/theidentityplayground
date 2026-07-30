// Module 2 · account types, on its own page.
//
// Like SCIM_PATH and unlike APP2_PATH or GUEST_PATH, this string is duplicated
// nowhere else: the page authenticates nobody, so no app registration has a
// redirect URI that must match it character for character.
//
// public/staticwebapp.config.json needs no rule. navigationFallback already
// rewrites any unmatched path to /index.html, so this falls through to the SPA
// and main.tsx routes it.

export const ACCOUNTS_PATH = '/accounts'

export function isAccountsPath(pathname: string): boolean {
  return pathname === ACCOUNTS_PATH || pathname === `${ACCOUNTS_PATH}/`
}

/**
 * Which identity to light on arrival, carried in the URL.
 *
 * The map used to sit on the homepage, where App knew whether the visitor was
 * running the member sample or had come back from a live guest sign-in, and
 * passed it down. Moving the map to its own page would have quietly dropped that
 * — the map would render, and the tie between "who you signed in as" and "what
 * that identity can reach" would be gone without anything looking broken.
 *
 * So the homepage puts it in the link. A query string rather than sessionStorage
 * because it survives being shared, and because the state is a view preference
 * rather than a session fact.
 */
export function activeKeyFrom(search: string): string | undefined {
  const key = new URLSearchParams(search).get('as')
  return key === 'guest' || key === 'member' || key === 'customer' ? key : undefined
}
