/**
 * Clearing a stale MSAL interaction lock left behind by the OTHER application.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 *
 * MSAL records "an interactive request is in flight" at ONE key for the whole
 * origin:
 *
 *   msal.interaction.status  →  {"clientId":"<guid>","type":"signin"}
 *
 * The client ID is in the VALUE, not the key. Verified in msal-browser 5.17.1,
 * `dist/cache/BrowserCacheManager.mjs`: `isInteractionInProgress()` returns true
 * for ANY clientId when it is not asked to match, and `setInteractionInProgress`
 * throws `interaction_in_progress` when it finds an existing lock, whoever wrote
 * it. Its own comment says so.
 *
 * `main.tsx` boots exactly one instance per page load, chosen by path, and
 * `handleRedirectPromise` runs in exactly one place (`app2/mountApp2.tsx`). So
 * app2 sets the lock and only app2 can clear it. A visitor who starts an /app2
 * redirect and never completes it strands that lock, and the next load of "/"
 * can neither sign in nor sign out: the instance that would release it does not
 * exist on that page.
 *
 * ── Why clearing it is safe, which is the whole argument ────────────────────
 *
 * The lock lives in sessionStorage, and sessionStorage is PER TAB. `main.tsx`
 * boots one instance per page load. So within a single tab, a booting main app
 * is proof that the visitor has navigated away from app2's flow: app2's
 * instance no longer exists, nothing is going to consume that authorization
 * response, and the lock is stale by definition. The reverse holds for app2
 * booting against a main-app lock, which is why both boot paths call this.
 *
 * What must never happen is clearing a lock belonging to the booting instance's
 * OWN client ID. That lock is live: it means this instance is mid-redirect and
 * `handleRedirectPromise` is about to consume the response. Clearing it would
 * break every sign-in. The client ID comparison below is the entire safety
 * property, and it is what `interactionLock.test.ts` asserts hardest.
 */

/**
 * The key MSAL writes the interaction lock to.
 *
 * Mirrors `${PREFIX}.${TemporaryCacheKeys.INTERACTION_STATUS_KEY}` in
 * msal-browser 5.17.1: PREFIX is "msal" in `dist/cache/CacheKeys.mjs`, and
 * INTERACTION_STATUS_KEY is "interaction.status" in
 * `dist/utils/BrowserConstants.mjs`. It is written with `generateKey: false`,
 * which is precisely why no client ID is spliced into the key.
 *
 * Hardcoded because the package does not export it. Its `exports` map exposes
 * only ".", "./custom-auth", "./redirect-bridge" and "./popup-relay", and
 * `TemporaryCacheKeys` is not re-exported from the root, so there is no import
 * to reach for. One literal in one place: on an MSAL version bump this is the
 * single thing to re-check.
 */
const MSAL_INTERACTION_STATUS_KEY = 'msal.interaction.status'

/**
 * Should a lock holding `rawValue` be cleared by an instance booting as
 * `bootingClientId`?
 *
 * Pure on purpose. The decision is the risky part of this fix and auth cannot
 * be exercised in the dev environment here, so the decision is separated from
 * the storage access and unit-tested on its own.
 *
 * Conservative by design: it returns true ONLY when the stored value positively
 * identifies a different client. Anything it cannot read, it leaves alone.
 *
 * @param rawValue the raw string read out of storage, or null when absent
 * @param bootingClientId the client ID of the instance that is starting
 */
export function shouldClearInteractionLock(
  rawValue: string | null | undefined,
  bootingClientId: string,
): boolean {
  // Covers absent (null/undefined) and empty string in one check.
  if (!rawValue) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(rawValue)
  } catch {
    // Unparseable. Leave it. MSAL's own `getInteractionInProgress()` already
    // removes this key when JSON.parse throws and resets its request cache with
    // it, so its recovery is better placed than a guess from out here. What
    // matters is that a malformed value does not throw during boot.
    return false
  }

  // JSON.parse happily returns null, numbers, strings and arrays. Only an
  // object can carry the clientId we need.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false
  }

  const clientId = (parsed as { clientId?: unknown }).clientId

  // No usable clientId means we cannot prove the lock is foreign, so we do not
  // touch it. Deliberately not treated as "stale, therefore clear".
  if (typeof clientId !== 'string' || clientId === '') return false

  // THE SAFETY PROPERTY. A lock stamped with our own client ID is live, not
  // stale, and clearing it would break the redirect we are in the middle of.
  return clientId !== bootingClientId
}

/**
 * Read the stored lock and remove it if it belongs to a different client.
 *
 * Call this BEFORE `initialize()` and `handleRedirectPromise()`. Afterwards is
 * too late: MSAL has already read the lock and thrown by then.
 *
 * Only sessionStorage is checked, and that is a measured decision rather than
 * an assumption. msal-browser 5.17.1's `BrowserCacheManager` constructor builds
 * `temporaryCacheStorage` with a hardcoded `BrowserCacheLocation.SessionStorage`
 * while only `browserStorage` honours the configured `cache.cacheLocation`. The
 * interaction lock is a temporary cache item, so it lands in sessionStorage no
 * matter what the config says. Both configs in this repo say sessionStorage in
 * any case.
 *
 * @returns true when a foreign lock was found and removed
 */
export function clearForeignInteractionLock(bootingClientId: string): boolean {
  try {
    const rawValue = window.sessionStorage.getItem(MSAL_INTERACTION_STATUS_KEY)
    if (!shouldClearInteractionLock(rawValue, bootingClientId)) return false

    window.sessionStorage.removeItem(MSAL_INTERACTION_STATUS_KEY)
    // Console only, never surfaced in the UI. This is the one signal that the
    // fix fired, and it costs nothing to leave in.
    console.warn('[msal] Cleared a stale interaction lock from a different client:', rawValue)
    return true
  } catch {
    // Touching sessionStorage can throw outright when storage is disabled or
    // the page is sandboxed. This runs on the auth boot path before anything
    // else, so it must never be the reason the app fails to start.
    return false
  }
}
