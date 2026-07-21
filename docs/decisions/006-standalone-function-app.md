# 006. Standalone Function App over SWA's managed API

**Status:** decided 16 July 2026 (commit `a4605b4`); **implemented 21 July 2026.** The
standalone Function App is deployed on consumption (`func-theidentityplayground`) via a
keyless OIDC workflow, `.github/workflows/deploy-api.yml`. `deploy-web.yml` still sets
`api_location: ""` — SWA stays static-only and the Function App deploys separately, the
two-deployment split this decision chose. What shipped it first was not the cleanup (that
stayed on GitHub Actions per decision 003) but Module 2's rate-limiting foundation: a
per-IP limiter, live and verified ahead of any Graph endpoint.

Every factual claim below is marked **[M]** if it was read in current project documentation
(source given) or **[A]** if it is assumed and still needs testing. As of 21 July the core platform claims
(a consumption Function App reached cross-origin, CORS on the site origin, keyless OIDC
deploy) are **[M]**, verified by deploying it. The pricing specifics remain **[A]**,
researched in July 2026 and not re-read against Microsoft's docs since.

Sources are cited by section rather than line number, because the spec moves.

---

## Context

Static Web Apps offers two ways to host a backend and they are not equivalent. **[M]**
(spec § 2 → Decision: the backend is a standalone Function App)

| | Managed Functions | Bring-your-own Function App |
|---|---|---|
| Triggers | HTTP only. No timer, no Durable | Full Functions feature set |
| SWA plan | Free | Standard, about $9/mo |

**[A]** on both rows. The commit message states the same limitation independently: SWA's
managed Functions support HTTP triggers only, no timer and no Durable. **[M]** (`a4605b4`)

**What forced the choice:** Module 7's lifecycle cleanup is a timer trigger, so managed
Functions could not host this backend at all. **[M]** (spec § 2; commit `a4605b4`) That is a
capability gap, not a preference.

The obvious fix, SWA Standard plus a linked backend, costs about $9 a month and triples
hosting for convenience the project does not need. **[M]** (spec § 2; commit `a4605b4`)

## Decision

**SWA Free hosts the static site only. The entire backend, including timer triggers, lives
in one standalone Function App on consumption, with a 1M-execution monthly free grant. The
SPA calls it cross-origin.** **[M]** (spec § 2; commit `a4605b4`;
[deploy-web.yml](../../.github/workflows/deploy-web.yml) header comment, which states the
same thing at the point it takes effect)

This matched what `api/` already was, so it required no rework. **[M]** (commit `a4605b4`)

## Rejected alternatives

**SWA managed Functions.** Cannot run a timer trigger. Rejected on capability, before cost
entered the argument. **[M]**

**SWA Standard plus a linked backend.** About $9 a month against about $0. What the money
buys is same-origin `/api` proxying and SWA's integrated auth. Neither is used: MSAL does
all auth, so SWA's integrated auth would go unused, and same-origin proxying is the only
real benefit on offer. **[M]** (commit `a4605b4`; spec § 2)

**No other backend host was considered.** App Service, Container Apps and a VM do not
appear in the source prose for this decision. There is no recorded reason for rejecting
them, so none is offered here.

## Consequences

Recorded in the spec at the time of the decision, including what it makes harder. **[M]**
(spec § 2 → Decision: the backend is a standalone Function App)

- **CORS must be configured on the Function App,** allowlisting the site origin. One-time
  setup, not a project.
- **No same-origin `/api` proxying.** The SPA calls the Function App's own hostname. Expect
  the "why isn't the API behind `/api`?" question in an interview. The answer is the table
  above.
- **SWA's built-in auth is unused.** Irrelevant, because MSAL does all auth.
- **Two deployments instead of one,** SWA and the Function App.
- **Cost: about $0 instead of about $9 a month.**

### Why it is deferred, and what would reopen it

**Superseded 21 July 2026 — implemented.** What ultimately shipped the Function App was
neither candidate below but Module 2's rate-limiting foundation, and the rate-limiting
requirement went live with it. The reasoning is kept for the record.

Decision 003 solved the demo-account cleanup with a GitHub Actions scheduled workflow and a
federated identity credential, running the PowerShell script that already works. **[M]**
([003](003-cross-tenant-graph.md) § Decision) So the timer trigger that forced this
decision no longer forces anything today.

003 records the state explicitly: no Function App is deployed and none is needed for the
cleanup, `api/` and `api_location: ""` both stay as they are, and decision 006 is not
reversed but deferred. The first thing that actually needs a Function App is Module 7's
stats endpoint or Module 3's log correlation. **[M]** ([003](003-cross-tenant-graph.md)
§ Consequences)

Two candidates would reopen it. 003's proposed cleanup monitor has an endpoint option that
reads a Table Storage row, which it notes would reopen 006 and add the first always-on
Azure resource to a $0 hosting posture. **[M]** ([003](003-cross-tenant-graph.md), closing
section) Decision 008, self-service account deletion, is the other: the Phase 0.5 gate
records that its rate-limiting requirement is "not applicable, no Function is deployed",
and becomes live the moment 008 ships, "which is exactly that shape of endpoint". **[M]**
(spec § 5, Phase 0.5)

When either ships, this decision is what it ships onto, and that rate-limiting requirement
goes live at the same moment.
