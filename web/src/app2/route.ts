// The one place that knows where the second app lives.
//
// This is a single string, and it is duplicated in three systems that cannot
// import from each other, so it is worth being explicit about all three:
//
//   1. HERE — the client-side route check in main.tsx.
//   2. The Entra app registration for the CrossAppSSO client, whose redirect
//      URI is literally `https://theidentityplayground.com/app2`. Entra matches
//      redirect URIs by exact string; a trailing slash is a mismatch.
//   3. `public/staticwebapp.config.json`, whose navigationFallback rewrites
//      unmatched paths to /index.html. Without that file Azure Static Web Apps
//      returns a hard 404 for /app2, because there is no file at that path —
//      the SPA never gets a chance to route. That config also EXCLUDES
//      /blank.html from the fallback, which matters: blank.html must keep being
//      served as a real file or MSAL's silent-auth iframe loads the whole SPA
//      instead of a few hundred bytes of nothing.
//
// Change this string and all three have to change together.

export const APP2_PATH = '/app2'

/**
 * Is this pathname the second app?
 *
 * Tolerant of a trailing slash on the way IN (a visitor may type either, and a
 * static host may normalise), but the redirect URI we hand Entra is always the
 * canonical no-slash form — see app2MsalConfig.
 */
export function isApp2Path(pathname: string): boolean {
  return pathname === APP2_PATH || pathname === `${APP2_PATH}/`
}
