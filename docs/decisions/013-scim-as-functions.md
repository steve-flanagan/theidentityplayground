# 013. Build the SCIM endpoint as Functions, written to the RFC, and absorb Entra's deviations

**Status:** decided and **proven end to end** 28 July 2026. Module 5's backend is live.
Retires [001](001-container-apps-over-container-instances.md)'s container.

Every factual claim is marked **[M]** if it was read in current documentation (source and date
given), **[O]** if it was observed running, or **[A]** if it is assumed.

---

## Context

Module 5 provisions a demo employee from Microsoft Entra into a downstream app over SCIM. That
needs three things this project did not have: somewhere to host a SCIM endpoint, a way to write
to a foreign tenant at request time, and a decision about whose SCIM dialect to implement.

The second was answered by [012](012-cross-tenant-graph-keyless.md). This record is the other two,
and the three Microsoft behaviours that turned out to matter more than any of it.

**The obvious path was the one Microsoft publishes, and it is a trap.** The tutorial deploys a
.NET reference implementation to Azure App Service. Its own page warns that the linked reference
code targets **.NET Core 3.1, which is out of support**, that the upstream repository provides it
"as is" with no guarantee of active maintenance, and that upgrading the target framework may be
necessary. **[M]** ([use-scim-to-build-users-and-groups-endpoints](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-build-users-and-groups-endpoints),
ms.date 2026-04-27, updated 2026-04-28.) It is also C#, in a repo whose stated convention is one
language front and back, Node.

**This project had also mispriced the work.** `notes/next-build.md` called SCIM "the biggest" and
"weeks". That was a list of components treated as an estimate. It was never costed.

## Decision

**HTTP Functions in the existing Function App, written to RFC 7644 rather than to any one client.**

Implemented in [`api/src/lib/scim/`](../../api/src/lib/scim/) and
[`api/src/functions/scimUsers.ts`](../../api/src/functions/scimUsers.ts).

**No new resource, and one retired.** It reuses the keyless OIDC deploy, the per-IP rate limiter,
HTTPS, and `@azure/data-tables`, which was already a dependency. **Incremental Azure cost is
zero.** More usefully, it means [001](001-container-apps-over-container-instances.md)'s Container
Apps instance is **unnecessary rather than deferred** — that was described there as the first
genuinely unbounded resource in the design, and it now has no reason to exist.

**Written to the RFC on purpose.** An endpoint that encodes one client's quirks as its contract is
a connector for that client wearing a SCIM endpoint's URL. Okta can provision to this unchanged,
and that property is the reason to spend the extra care rather than a lucky side effect.

**Requirements read, not remembered.** Microsoft's must-support list is: create users; modify with
PATCH; retrieve a known resource; query by `userName` and `externalId`; `excludedAttributes=members`
when querying groups; **support listing and pagination**; soft-delete via `active=false` with the
user still returned on GET; **support the `/Schemas` endpoint**; accept a single bearer token.
Groups are optional — only one of users or groups is required. **[M]**
([use-scim-to-provision-users-and-groups](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups),
ms.date 2025-10-06, updated 2026-07-24.) **An earlier estimate on this project called `/Schemas`
"cheap-but-optional" and omitted pagination entirely. Both are mandatory.**

## The three things that cost real time

**1. Entra's PATCH is still not SCIM-compliant, and the fix is incompatible with the demo.**
Microsoft's own compliance page lists "Update PATCH behavior to ensure compliance (such as active
as boolean…)" as **Fixed? No**. Without the `aadOptscim062020` flag the service sends capitalised
ops and disables a user with the **string** `"False"`. The page also states that flag "currently
doesn't work with on-demand provisioning". **[M]**
([application-provisioning-config-problem-scim-compatibility](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/application-provisioning-config-problem-scim-compatibility),
ms.date 2025-08-25, updated 2026-02-05.)

On-demand is what the demo needs — a visitor will not wait out a sync cycle. So the non-compliant
client behaviour is chosen deliberately and
[`patch.ts`](../../api/src/lib/scim/patch.ts) absorbs both shapes.

**`Boolean("False")` is `true`.** A naive implementation enables every account it was asked to
disable, returns 200, and reports a healthy cycle at both ends: a security bug that looks like a
working integration from either side. That single coercion is why `api/` now has a test runner.
**Confirmed against live traffic [O]**, not just fixtures — a real Entra PATCH flipped
`demo.rowan.5cfd7cc3` to `active: false` on 28 July at 18:28:16Z.

**2. `ruleId` is effectively required for app-only `provisionOnDemand`.** Graph's reference marks
the parameter optional and the portal supplies it invisibly, so a hand-rolled app-only call
without it fails, with no obvious cause. **[O]** — two live hires were spent discovering this;
with `SCIM_SYNC_RULE_ID` unset the call failed, and set, the identical call returned 200.

**3. `active` maps from `IsSoftDeleted`, not from `accountEnabled`, and that makes disabling a
silent no-op.** The stock mapping is `Switch([IsSoftDeleted], , "False", "True", "True", "False")`
**[O]**, read from the job schema. Disabling an account changes nothing that mapping reads, so
Entra computes no difference and **sends no request at all** — not an error, not a wrong value,
nothing. The mapping has to be repointed at `accountEnabled`.

This is the one most likely to bite someone else. A green provisioning run that transmits nothing
is indistinguishable from a green run that worked.

## Consequences

**One stored secret, inbound, and it is not a regression.** Entra presents a bearer token to *us*;
we never hold it to reach anyone. The count of credentials this system holds in order to call
other systems is still zero. Microsoft's keyless alternative — Workload Identity Federation for
SCIM provisioning — is **gallery-only** **[M]**, so it is unavailable to a non-gallery app. The
token lives in Key Vault, is read by the system-assigned identity, is compared in constant time,
and **fails closed** if the vault is unreachable.

**`employeeType = 'scim-demo'` is now load-bearing in four places.** The hire flow stamps it, the
cleanup sweep matches on it, terminate refuses to delete anything without it, and the provisioning
scoping filter selects on it. Changing that string breaks the demo, the deletion safety guard, and
the self-destruct promise simultaneously.

**Terminate reads before it deletes.** The object id arrives from a public request; a uuid-shaped
path segment is a format check, not an authorisation check. Without the read this endpoint is an
unauthenticated delete-any-user-in-the-tenant bounded only by a rate limit.

**The downstream app expires its own rows.** The site promises every demo account self-destructs,
and that was only ever true of the directory object — the PowerShell sweep has no idea Table
Storage exists. A separate timer now expires SCIM rows on a longer TTL. Separate on
[009](009-workforce-guest-cleanup.md)'s reasoning: it holds no Graph permission at all and can
delete rows in one table and nothing else.

**`api/` had no CI job before this.** Backend code was neither typechecked nor tested on any PR.
Added, though making it a *required* check is a ruleset change and Steve's.

**`/api/ping` and `/api/tenant-probe` are removed.** Both said in their own headers that they were
scaffolding to be deleted once a real endpoint exercised the rate limiter and the cross-tenant
credential chain in production. This is that endpoint.

## Alternatives considered

**Microsoft's .NET reference implementation on App Service.** Rejected: an out-of-support runtime,
an unmaintained sample, a second language in the repo, and an App Service bill, in exchange for
code we would have had to read and modify anyway.

**Container Apps**, per [001](001-container-apps-over-container-instances.md). Rejected: nothing
about a SCIM endpoint needs a container once the Function App can serve HTTPS and reach Graph.
Given up: nothing. This is strictly the cheaper answer, and 001's cost concern disappears with it.

**Implementing only what Entra sends.** Rejected, and this is the alternative with a real cost —
it would have been less code and less thought. Given up: a working Okta path, and any claim that
this is a SCIM endpoint rather than an Entra connector.

**Applying `aadOptscim062020` to get compliant PATCH behaviour.** Not chosen, and **not yet
decided** — it disables on-demand provisioning, which the demo depends on. Left open deliberately
rather than settled by drift. The current arrangement has a genuine merit: a real interoperability
wart, demonstrated live, on a site about identity.
