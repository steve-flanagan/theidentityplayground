/**
 * Where the backend lives. The one place that knows.
 *
 * ── WHY THIS IS ABSOLUTE AND NOT `/api` ──────────────────────────────────────
 *
 * Because `/api` on this origin is a LIE that returns 200.
 *
 * The Function App is standalone (decision 006) rather than an SWA-managed API,
 * and linking a backend to a Static Web App requires the Standard SKU, which 006
 * refused at $9/mo. So Static Web Apps never proxies /api anywhere. What it does
 * instead is worse than a 404: public/staticwebapp.config.json's
 * navigationFallback rewrites every unmatched path to /index.html, and /api is
 * unmatched. A fetch to /api/anything therefore returns **200 with the SPA's
 * HTML**, res.ok is true, and res.json() throws somewhere far away from the
 * cause.
 *
 * Verified 29 July 2026: `curl https://theidentityplayground.com/api/health`
 * returns 200 with content-type text/html and the site's markup, while the same
 * path on the Function App's own host returns {"status":"ok","phase":0}.
 *
 * THE COST OF THIS CHOICE, so nobody is surprised by it: cross-origin requests
 * mean the Function App has to allow each calling origin explicitly. Production
 * and www are configured. **SWA preview environments get a new origin per pull
 * request** (witty-coast-0bf87fd0f-<PR>.eastus2.7.azurestaticapps.net), so a
 * preview cannot call the backend until that origin is added:
 *
 *   az functionapp cors add -n func-theidentityplayground \
 *     -g rg-theidentityplayground --allowed-origins https://<preview-host>
 *
 * That is a real papercut and it is the price of not paying $9/mo. Worth
 * revisiting only if previews start needing the backend routinely.
 */
export const API_BASE = 'https://func-theidentityplayground.azurewebsites.net/api'
