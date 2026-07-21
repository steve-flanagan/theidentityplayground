# 003. Cross-tenant Graph for the demo-account cleanup

**Status:** decided 20 July 2026. Tenant side built and consented; code side built and
merged. **Run against the tenant twice on 20 July:** a dispatch dry run at 18:06Z and a
scheduled run at 19:58Z that was armed to delete. Both authenticated and both found zero
expired accounts, so **the delete path itself has still never executed.** The
verification list in section 3 is not satisfied. Item 9 requires items 5 through 8, and
6 and 8 are open.

Every factual claim below is marked **[M]** if it was read in current documentation
(source and date given) or **[A]** if it is assumed and still needs testing. The **[A]**
items are the ones that can fail on day one.

---

## Update, 20 July 2026: what building it settled, and what it did not

The gate is passed and the decision stands. Four things below turned out differently
from how they were written, and the original text is left in place underneath so the
reasoning is still legible. Nothing here is a quiet edit.

### 1. The permissions gate is passed. External tenants do expose Graph application permissions

All three application permissions were added and consented in the External ID tenant,
confirmed green in the portal. **[M]** The feature-comparison line this decision flagged
as possibly fatal, that external-tenant registrations are limited to `offline_access`,
`openid` and `User.Read` plus **My APIs**, describes the *delegated* permission picker.
It does not constrain app roles. The whole decision was gated on this and the gate is
open.

### 2. `az ad app permission admin-consent` works where the portal does not

The portal's **Grant admin consent** button failed with *"does not have a subscription
(or service principal)"*, which is misleading: it names a subscription problem for what
is not one. The CLI performed the same grant with no error. **[M]** Worth knowing before
concluding a tenant cannot consent. Prefer the CLI here.

### 3. The billing concern was wrong, and the residual is narrower than it looks

This decision treated the M2M meter as a possible blocker on getting a token at all, and
told Steve to check **Home > Billing** for the tenant's linked subscription. **That was
the wrong blade.** It is B2B collaboration billing for workforce tenants. There is no
subscription linked to the External ID tenant and there is nothing to link there.
Consent succeeded without one. **[M]**

The assumption is corrected, not deleted, because a narrower version of it is still
open. Microsoft's client-credentials page now carries a note that M2M authentication for
External ID "must use the M2M Premium add-on". **[M]**
[v2-oauth2-client-creds-grant-flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)
(ms.date 2026-01-30, updated 2026-06-15). Whether that note is enforced at token
issuance, and whether a Microsoft Graph token counts as M2M at all when the app holds
only directory application permissions, is **still unstated anywhere in Microsoft's
docs**. **[A]**

So the corrected position: nothing about billing blocks the setup, and consent proved
it. **Settled 20 July: the token issues.** **[M]** Both runs got a Graph token from
`login.microsoftonline.com`, so issuance is not gated on the M2M Premium add-on.

Whether a charge lands for it is a different question and is still open. That is item 8
of the verification list, and no billing data is reachable from the repo or from `gh`.

### 4. The federated credential subject in this document is probably wrong for this repo

The subject recorded below, `repo:steve-flanagan/theidentityplayground:ref:refs/heads/main`,
is the legacy format. GitHub changed the default: **"Repositories created after July 15,
2026 now use an immutable default subject format that includes both the owner ID and
repository ID."** **[M]**
[OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc),
[changelog 2026-04-23](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/).

`steve-flanagan/theidentityplayground` was created **2026-07-16**, one day inside the new
behaviour. **[M]** (`gh api repos/steve-flanagan/theidentityplayground`.) GitHub's own
preview endpoint returns the immutable prefix for it:

```
$ gh api repos/steve-flanagan/theidentityplayground/actions/oidc/customization/sub
{"use_default":true,
 "use_immutable_subject":false,
 "sub_claim_prefix":"repo:steve-flanagan@234824944/theidentityplayground@1302989710"}
```

So the subject to register is almost certainly:

```
repo:steve-flanagan@234824944/theidentityplayground@1302989710:ref:refs/heads/main
```

**Settled 20 July: the immutable format was right.** **[M]** Two clean exchanges against
it, and the run prints the subject it presented:
`repo:steve-flanagan@234824944/theidentityplayground@1302989710:ref:refs/heads/main`.

`use_immutable_subject` still reads `false` while the prefix reads immutable, so the
field is as misleading as it was. The failure this guarded against did not happen: a
wrong subject saves without complaint and fails only at exchange, with an AADSTS error
that does not name the mismatch.

Rather than guess, the workflow decodes the token it is about to present and prints the
issuer, subject and audience before exchanging it. The first dispatch run prints the
exact string to paste into the credential, whichever format GitHub actually used. That
turns the one-shot trap into a two-minute loop.

---

## Context

The site tells every visitor that demo accounts self-destruct. That sentence is false
today. The cleanup exists only as `scripts/Remove-ExpiredDemoAccounts.ps1`, run by hand.
It ran once on 20 July and removed every demo account except the Global Admin and one
fresh sign-up. The claim goes false again at the next sign-up.

The users live in the External ID tenant `7e8da8a9-67bc-4d53-bfc7-fe3e13128382`. The
subscription lives in Steve's own tenant. A managed identity is a service principal in
the tenant that owns the subscription, so it cannot authenticate into the External ID
tenant. That is the blocker, and it is not something a code change moves.

Three things a workforce-tenant instinct gets wrong here, all checked:

- **A managed identity cannot be a federated credential on a foreign-tenant app.** "Both
  the Microsoft Entra app and managed identity must belong to the same tenant." The same
  page repeats it for the subject: "The managed identity must be in the same tenant as
  the app registration." **[M]**
  [workload-identity-federation-config-app-trust-managed-identity](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity)
  (ms.date 2025-06-06). The documented escape is a multitenant app provisioned into the
  other tenant, which external tenants do not support: app registrations there "always
  use accounts in this organizational directory only (single tenant)." **[M]**
  [concept-supported-features-customers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-supported-features-customers)
  (ms.date 2026-03-30). So the managed-identity route is closed in both directions.

- **`User.ReadWrite.All` does not cover the purge.** For the `user` resource, the
  application permission for `DELETE /directory/deletedItems/{id}` is
  `User.DeleteRestore.All`. **[M]**
  [directory-deleteditems-delete](https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-delete?view=graph-rest-1.0)
  (ms.date 2025-11-17). That permission grants exactly three endpoints:
  `DELETE /directory/deletedItems/{id}`, `POST /directory/deletedItems/{id}/restore`, and
  `DELETE /users/microsoft.graph.agentUser/{userId}`. It does not grant
  `DELETE /users/{id}`. **[M]**
  [graphpermissions.merill.net](https://graphpermissions.merill.net/permission/User.DeleteRestore.All).
  The script's purge works today only because it runs on a Global Admin's delegated
  token, where the role carries it.

- **Client-credentials tokens are a billed meter in an external tenant.**
  **[SUPERSEDED as a blocker. See update 3 above.]** M2M
  Authentication is a transaction-based premium add-on: "Transaction charges based on the
  number of client credential authentication requests; for example, one token refresh per
  hour produces approximately 720 transactions per month." **[M]**
  [external-identities-pricing](https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing)
  (ms.date 2026-06-22). Whether a Microsoft Graph token counts, and whether the add-on
  must be switched on before the first token will issue, is **not stated anywhere in
  Microsoft's docs**. **[A]** A third-party report puts the rate at $0.001 per token from
  1 November 2025; Microsoft's own pricing page does not publish an M2M figure. **[A]**

## Decision

One app registration in the External ID tenant, three application permissions, and
**no stored credential**. Federated identity credential, GitHub Actions as the issuer,
running the PowerShell script that already works.

Federated credentials are supported on external-tenant app registrations: the credential
row reads "Same as workforce" and lists certificates, client secrets, and federated
credentials. **[M]** [concept-supported-features-customers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-supported-features-customers).
Client credentials are listed as supported in external tenants for v2.0 applications. **[M]**
Same page.

### Permissions, application type, admin-consented in the External ID tenant

| Permission | Covers | Source |
|---|---|---|
| `User.ReadWrite.All` | `GET /users`, `DELETE /users/{id}`. Documented as least privileged and the only application option for the soft delete. **[M]** | [user-delete](https://learn.microsoft.com/en-us/graph/api/user-delete?view=graph-rest-1.0) (ms.date 2024-07-24) |
| `User.DeleteRestore.All` | `DELETE /directory/deletedItems/{id}`, the purge. **[M]** | [directory-deleteditems-delete](https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-delete?view=graph-rest-1.0) |
| `RoleManagement.Read.Directory` | `GET /directoryRoles` and `/directoryRoles/{id}/members`, for the role-exclusion guard. Documented least privileged; `Directory.Read.All` is the higher-privileged alternative and is not needed. **[M]** | [directoryrole-list](https://learn.microsoft.com/en-us/graph/api/directoryrole-list?view=graph-rest-1.0), [directoryrole-list-members](https://learn.microsoft.com/en-us/graph/api/directoryrole-list-members?view=graph-rest-1.0) (ms.date 2024-10-25) |

No directory role is assigned to the service principal. A role is required only to delete
or restore users who themselves hold a privileged administrator role, which this job must
never do. **[M]** Both delete pages, same caveat.

`Directory.Read.All` in the current script drops out. It was the delegated scope for
resolving role membership; `RoleManagement.Read.Directory` does the same job with a
narrower grant.

### Credential

GitHub Actions OIDC. The workflow requests an ID token with audience
`api://AzureADTokenExchange`, presents it as a `client_assertion` at the External ID
tenant's token endpoint, and receives a Graph token. Nothing is stored, so nothing
expires and nothing rotates.

Federated identity credential on the app registration:

```
issuer     https://token.actions.githubusercontent.com
subject    repo:steve-flanagan/theidentityplayground:ref:refs/heads/main
audience   api://AzureADTokenExchange
```

**The gate. [PASSED 20 July 2026. See update 1 above.]** External-tenant app registrations
are documented as restricted to
"Microsoft Graph `offline_access`, `openid`, and `User.Read`, along with your **My APIs**
delegated permissions." **[M]**
[concept-supported-features-customers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-supported-features-customers).
Read literally that forbids every permission in the table above, and no Microsoft page
contradicts it or carves out app-only management access. It may describe only the portal
picker. **[A]** Nothing else in this decision matters until that is tested, and the test
takes five minutes: see step 3 of the portal sequence.

The guess was right: the line describes the delegated picker only. All three application
permissions added and consented without a workaround.

### Tenant-side state as built

Do not re-derive any of this.

```
Tenant (External ID)  7e8da8a9-67bc-4d53-bfc7-fe3e13128382
App registration      demo-account-cleanup
Client ID             2d0fb6bd-4e37-463c-9a9a-4b78bde66803
```

| Permission | Type | State |
|---|---|---|
| `User.ReadWrite.All` | Application | Granted and consented **[M]** |
| `User.DeleteRestore.All` | Application | Granted and consented **[M]** |
| `RoleManagement.Read.Directory` | Application | Granted and consented **[M]** |
| `User.Read` | Delegated | Granted, default from registration **[M]** |

**No directory role is assigned, deliberately.** That is what stops it deleting admins.
The API refuses to delete a holder of a privileged administrator role unless the caller
holds one too, so this is enforced at Graph and not only by the script's own guard.

Nothing is still to do in the tenant. The federated credential exists and works: two
token exchanges succeeded on 20 July against the subject in update 4 above. **[M]**

## Rejected alternatives

**Certificate in Key Vault, read by a timer Function's managed identity** (the proposal
this decision was written to evaluate). Supported, and the tenant-boundary reasoning is
correct: the managed identity never leaves its own tenant and the cross-tenant hop is an
ordinary confidential-client flow. Rejected for two reasons, in order:

1. It requires reimplementing the script. The repo is Node/TypeScript front and back, and
   a TypeScript rewrite means rewriting the four guards: the sign-up-flow allowlist, the
   role exclusion, the explicit UPN protection, and the purge. Those guards are the entire
   safety argument for letting a machine delete users, and they were verified against
   synthetic users under `Set-StrictMode`. Rewriting them to change how a token is
   acquired trades a tested guard for an untested one.
2. A certificate expires. When it does, the job fails, and unless someone is watching, the
   site's promise goes false again silently. That is the exact failure this decision
   exists to end.

Keep it as the fallback if the GitHub issuer is rejected on a CIAM app registration. The
portal work up to the credential is identical, so the fallback costs only the credential
step plus the Function App.

**Managed identity as a federated credential on the External ID app.** Not supported.
Same-tenant requirement, stated three times on the Microsoft page. **[M]**

**Multitenant app in Steve's tenant, service principal provisioned into the External ID
tenant.** The documented cross-tenant pattern, but external tenants force single-tenant
app registrations and the gallery/consent surface there is reduced. **[M]** Untested and
unlikely; not worth the time given a working alternative.

**Entra ID Governance lifecycle workflows.** Not available in external tenants. **[M]**
Same feature comparison page. It would also be a much pricier SKU for user deletion that
Graph does free.

**Leaving it manual.** Rejected because the site makes the claim in the present tense.

## Consequences

**The cleanup needs no Function App, and does not use the one that now exists.** A standalone
Function App was deployed 21 July for Module 2's rate-limiting foundation
([decision 006](006-standalone-function-app.md)), but the cleanup still runs entirely on
GitHub Actions and reaches Graph with the federated credential above, not through it.
`deploy-web.yml` still sets `api_location: ""`: SWA stays static-only and the Function App
deploys separately. So decision 006 is now implemented, and none of it changes how the
cleanup authenticates.

**Push access to `main` becomes equivalent to deleting users in the External ID tenant.**
The federated credential trusts a repo ref. Branch protection on `main` stops being
hygiene and starts being an access control. This is the real cost of the keyless design
and it should be stated plainly rather than buried.

**A new silent failure mode replaces the old one.** "In a public repository, scheduled
workflows are automatically disabled when no repository activity has occurred in 60 days."
**[M]** [GitHub: events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
Only commits reset the timer. A repo that goes quiet for two months stops cleaning up and
raises nothing. The monitor below is not optional because of this.

**The `schedule` event can be delayed under load, and the shortest interval is 5
minutes.** **[M]** Same page. Irrelevant against a 24-hour TTL.

**The cleanup configuration becomes public.** The workflow file, the issuer, the subject,
and the permission set are all readable in the repo. That is intended.

### Blast radius if the trust is abused

`User.ReadWrite.All` app-only is the widest grant here: create, read, update and delete
any user in the External ID tenant. There is nothing narrower. No Graph permission grants
delete-only on users, and application permissions cannot be scoped to a subset of the
directory. The floor is the whole tenant's user objects.

What it cannot do: delete or restore users holding privileged administrator roles **[M]**;
reset passwords or manage authentication methods, which need `UserAuthenticationMethod.*`;
read or write anything outside users and role definitions.

`User.DeleteRestore.All` adds restore, so a leaked trust could bring back accounts the job
purged. Low impact, since the job purges on the next pass.

`RoleManagement.Read.Directory` is read-only and discloses who holds admin roles.

The tenant is a demo tenant whose accounts are already assumed compromised. The asset
worth protecting is the Global Admin, and it is protected by the privileged-role rule at
the API, not only by the script's own guard.

### The guards under automation

All four guards live in the script, and the script is what runs, so they survive verbatim.
That is most of why this option won.

Two changes in behaviour are worth naming:

- **`-Confirm:$false` removes `ShouldProcess` as a guard.** Three remain, and the
  allowlist is the load-bearing one. What is missing is a ceiling: the script has no cap
  on how many accounts a single run may delete, so a mistake in `$demoSignInTypes` or a
  tenant-wide change to `signInType` values would be unbounded. Add `-MaxDeletions` with a
  low default that aborts the run rather than truncating it.
- **`Connect-MgGraph -Scopes` becomes inert under app-only auth.** The token carries the
  consented application permissions regardless of what the script asks for. If
  `RoleManagement.Read.Directory` is missing, `Get-MgDirectoryRole` throws,
  `$ErrorActionPreference = 'Stop'` aborts, and nothing is deleted. That fails closed,
  which is the right direction.

### Monitoring, and why the obvious monitor is the wrong one

Alerting on job failure does not work here. The failure that breaks the promise is a run
that never starts, and a run that never starts produces no error to alert on. Disabled
schedules, a lapsed credential in the fallback design, and a deleted workflow all look
identical to silence.

The only check that tests the actual claim queries the tenant for sign-up-flow accounts
older than the cutoff and alerts when the count is non-zero. Cheap, and it fails loudly
for every cause at once.

### Cost

Compute is $0: GitHub Actions minutes are free on public repos, and no Azure resource is
added. The open number is the M2M meter. If Graph tokens count, an hourly schedule is
roughly 720 transactions a month, about $0.72 at the reported rate. **[A]** Inside the $10
budget, but it is a new meter on a budget scoped to `rg-theidentityplayground`, and this
charge lands on the External ID tenant's linked subscription. Confirm which subscription
that is before assuming the existing alerts cover it.

Cadence is the dial. Every six hours still honours a 24-hour TTL and cuts the meter to
about 120 transactions a month.

### What must never be in the repo

Nothing in this design produces a secret, which is the point. If the fallback is ever
used, these are the concrete artifacts:

- The app registration's private key in any form: `.pfx`, `.p12`, `.pem`, `.key`, or a
  base64 blob of one pasted into a workflow, a script, or a settings file. `.gitignore`
  already blocks all four extensions. The public `.cer` is not a secret and is not
  blocked; leave it that way but do not use `.cer` as a habitual export format, because
  the export dialog that produces it also offers the private key.
- Any client secret. There is no supported reason for this design to have one.
- Function App publish profiles, `*.publishsettings` and `*.pubxml`, already blocked.
  Deploy with OIDC rather than a publish profile.
- Graph access tokens in workflow logs. The token is fetched with `curl` or
  `Invoke-RestMethod` against the token endpoint; mask it and never `echo` the response.
  This is the most likely way a credential actually leaks here.
- Deleted accounts' UPNs and email addresses in run output or in the stats published to
  the front end. Publish counts. The visitor-facing stat is "how many were removed", not
  "who".

Tenant IDs, client IDs, the FIC subject and the Key Vault URI are public identifiers and
belong in the workflow file in plain text.

---

# Implementation scope

Not part of the decision. This is what has to be built, in order.

## 1. Steve, in the portal and the CLI

**Steps 1 through 8 are DONE**, step 5 as of 20 July, step 8 late the same day. State is
recorded under "Tenant-side state as built" above. Step 7 is withdrawn. Step 8, branch
protection on `main`, was the last one open and the highest-risk: the credential it guards
exists, so an unprotected `main` was a working path to `User.ReadWrite.All` over the
tenant. It is now closed by a repository ruleset on `main` that requires a pull request and
blocks force pushes and deletions. **[M]** (Steve created it 20 July. The classic
`gh api .../branches/main/protection` endpoint still returns 404 because a ruleset is a
separate feature, so verify it at Settings > Rules > Rulesets, not there. The proof it is
live: the first direct push to `main` after it was rejected with GH013 "Changes must be
made through a pull request".)

<details>
<summary>The original sequence, kept for the record</summary>

In the External ID tenant `7e8da8a9-67bc-4d53-bfc7-fe3e13128382`, as Global Admin.

1. **Entra admin center > Settings icon > Directories + subscriptions > switch to The
   Identity Playground.** Confirm the tenant ID in the banner before touching anything.
2. **Entra ID > App registrations > New registration.** Name `demo-account-cleanup`.
   Single tenant, which is the only option. No redirect URI, no platform. Record the
   Application (client) ID and the Object ID.
3. **API permissions > Add a permission > Microsoft Graph > Application permissions.**
   Add `User.ReadWrite.All`, `User.DeleteRestore.All`, `RoleManagement.Read.Directory`.
   **This is the gate.** If the picker offers no Microsoft Graph application permissions,
   the documented external-tenant restriction is real.
4. **Grant admin consent for The Identity Playground.** Verify all three read
   "Granted for The Identity Playground". Anything else means it did not take.
6. **Do not assign the app a directory role.** It does not need one, and giving it one
   would let it delete admins.

</details>

**Step 4 in practice: the portal button fails, the CLI works.** "Grant admin consent"
returned *"does not have a subscription (or service principal)"*. This did:

```powershell
az ad app permission admin-consent --id 2d0fb6bd-4e37-463c-9a9a-4b78bde66803
```

### Step 5, the federated credential. Done 20 July, and it worked first time

**Entra ID > App registrations > `demo-account-cleanup` > Certificates & secrets >
Federated credentials > Add credential.** Scenario **"Other issuer"** if the GitHub
scenario is not offered on a CIAM registration.

| Field | Value |
|---|---|
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject identifier | `repo:steve-flanagan@234824944/theidentityplayground@1302989710:ref:refs/heads/main` |
| Audience | `api://AzureADTokenExchange` |
| Name | `github-main` |

The subject is the immutable format, because this repo was created after GitHub's
15 July 2026 cutover. See update 4 above for why it is *probably* rather than certainly
that string, and for the check that settles it.

**A wrong issuer, subject or audience saves without error and fails only at token
exchange.** Propagation takes a few minutes, so a failure in the first minute or two is
not necessarily a wrong value. The workflow prints the exact subject it presented, so the
loop is: dispatch a dry run, read the printed subject, make the credential match it.

### Step 7 is withdrawn

**Home > Billing** was the wrong blade and there is no subscription linked to this
tenant. See update 3. Nothing to check, nothing to budget. What replaces it is verifying
step 8 of the verification list below, after the first few runs.

### Step 8, GitHub. Done 20 July via a ruleset

A repository ruleset on `main`: require a pull request before merging (0 approvals, so a
solo maintainer is not locked out), block force pushes, restrict deletions. Push access to
`main` is user-delete in the CIAM tenant, and this is the access control on it. Verified
working: the first direct `git push` to `main` afterward was rejected with GH013. From
here, changes to `main` go through a branch and a PR. **[M]**
9. No repository secret is required. Tenant ID and client ID can sit in the workflow file.

## 2. Code, and where it lives

**Built 20 July 2026.** What follows is what was built, and the three things that were
verified against current documentation rather than assumed.

- **`.github/workflows/cleanup-demo-accounts.yml`.** Schedule every six hours, plus
  `workflow_dispatch`. `permissions: { id-token: write, contents: read }` and nothing
  else. **Manual runs are `-WhatIf` by default**; deleting takes an explicit tick of the
  `delete` input. Written as "dry run unless scheduled or explicitly asked", so any event
  type added later lands on the safe side.

  The exchange, each hop measured:

  | Hop | Shape | Source |
  |---|---|---|
  | GitHub OIDC token | `curl -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=api://AzureADTokenExchange"`, JWT in `.value` | [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) **[M]** |
  | Exchange at Entra | POST `https://{host}/{tenant}/oauth2/v2.0/token`, form-encoded: `client_id`, `scope=https://graph.microsoft.com/.default`, `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `client_assertion={the GitHub token}` | [v2-oauth2-client-creds-grant-flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow), third case, ms.date 2026-01-30 **[M]** |
  | Into the SDK | `Connect-MgGraph -AccessToken` takes a **`SecureString`** | Verified against the installed SDK, not the docs: `(Get-Command Connect-MgGraph).Parameters['AccessToken'].ParameterType` is `System.Security.SecureString` in 2.38.1 **[M]** |

  **The token host is settled: `login.microsoftonline.com`. [M]** Both runs got a token
  from it on 20 July and the `ciamlogin.com` fallback was never needed. The reasoning
  that picked it, kept because it is why the default was right:

  Both Microsoft pages that document
  app-only Graph give `login.microsoftonline.com`, and neither mentions CIAM. **[M]**
  ([auth-v2-service](https://learn.microsoft.com/en-us/graph/auth-v2-service), ms.date
  2025-08-29.) `ciamlogin.com` is documented for user-facing flows in external tenants,
  which is not this. So `login.microsoftonline.com` is the default, and the host is a
  workflow input rather than a hard-coded string, so flipping it is a dropdown on a
  dispatch run and not a commit. **[M]** as of 20 July.

  **`Connect-MgGraph -AccessToken` does not accept `-TenantId`.** The AccessToken
  parameter set takes `AccessToken`, `Environment`, `ClientTimeout`, `NoWelcome` and
  `Break`, and nothing else. **[M]** Passing the tenant alongside the token is a binding
  error at runtime in the scheduled job, which is the worst place to find it. There is a
  test for this.

  **The SDK version is pinned to 2.38.1.** 2.35.1 shipped a regression where
  `-AccessToken` with a `SecureString` silently fell through to `ClientAssertionCredential`
  on Linux, which is precisely this code path on this runner.
  ([issue 3533](https://github.com/microsoftgraph/msgraph-sdk-powershell/issues/3533),
  fixed by PR 3542, merged 2026-02-25; 2.38.1 published 2026-07-13.) **[M]** Pinning also
  stops a bad SDK release taking the cleanup down on a day nobody is looking.

- **`scripts/Remove-ExpiredDemoAccounts.ps1`.** Two additive changes. An `-AccessToken`
  path, so one file serves the interactive run and the workflow. And `-MaxDeletions`,
  **default 10**, which **aborts the run** when the candidate count exceeds it rather than
  deleting up to the limit.

  Aborting rather than truncating is the whole point. A truncating cap would delete ten,
  exit 0, and delete ten more on the next run, so a broken allowlist would empty the
  tenant on a schedule with every run looking successful. The four guards are untouched.

  Ten, because with a 24-hour TTL and a six-hourly schedule a run only sees the accounts
  that crossed 24 hours inside that window. The number being defended against is not
  eleven, it is "every user in the tenant".

- **`scripts/Remove-ExpiredDemoAccounts.Tests.ps1`.** New. The README claimed the guard
  logic was verified by test; the test was never committed. It is now. Nineteen cases
  against synthetic users under `Set-StrictMode -Version Latest`, no network and no
  tenant, covering the four guards, the purge, `-WhatIf`, both auth paths, and the
  ceiling. Confirmed to fail against the pre-change script, so it discriminates.

- **Module 7 stats publishing.** Scoped below, not built.

## 3. Verified before the site's claim is allowed to stand

The whole point is not repeating a promise the system does not keep, so this list is the
gate, not a formality.

**Status as of 20 July: 3, 4 and 5 are met. 6 and 8 are not, so item 9 is not met and
the sentence on the site is not yet earned.**

1. Sign up a throwaway account through the live site. Record the UPN and the
   `createdDateTime`. **OPEN.** An account created 20 July is named in the session notes,
   but no record of its UPN or creation time exists in this repo. **[A]**
2. Confirm the real `signInType` values in the tenant. `scripts/README.md` flags this as
   the unverified assumption everything rests on, and it is still unverified. A value
   outside `$demoSignInTypes` means the script skips those accounts forever, silently, in
   the safe direction.

   **STILL OPEN, and the two runs cannot close it.** With a 24-hour cutoff and only young
   accounts in the tenant, "no aged accounts" and "signInType never matched" produce
   identical output. Zero candidates is not evidence either way.
3. Run the workflow via `workflow_dispatch` with **delete unticked**, which is the
   default. It must authenticate, report the tenant ID, and find zero candidates because
   the account is under 24 hours old.

   **MET 20 July, run 29766363116. [M]** Printed `DRY RUN.`, the tenant ID, and
   `Expired demo accounts : 0`.

   If it fails at the exchange, read the subject the run printed before the failure and
   make the federated credential match it exactly. That was the expected first failure.
   It did not happen: see update 4.

   The `AADSTS700016` fallback to `theidentityplayground.ciamlogin.com` was never needed.
   The host question is settled above.
4. Check the protected-principal count in that run. It must be non-zero. Zero means
   `Get-MgDirectoryRole` returned nothing and the role guard is not guarding. This is the
   single most important number in the first run, because the app holds
   `User.ReadWrite.All` over the whole tenant.

   **MET. [M]** Both runs printed `Protected by directory role: 1 principal(s)`.
5. Wait past 24 hours and let the schedule fire on its own. A manually triggered success
   proves the credential, not the schedule, and the schedule is what the promise depends
   on.

   **MET 20 July, run 29774156901, `event: schedule`, 19:58Z, success. [M]** It fired
   unattended. It had nothing to act on, which is item 6.
6. Confirm the account is gone from **Users** and from **Deleted users**. Present in
   Deleted users means the purge permission did not take, and a month of restorable PII is
   sitting behind a page that says otherwise.

   **NOT MET, and this is the one that matters.** The scheduled run was armed to delete,
   `WHAT_IF: false`, and found zero candidates, so `Remove-MgUser` and
   `Remove-MgDirectoryDeletedItem` have never been reached. What is proven is auth, the
   permission read path, the role guard, and the "nothing to do" branch.
7. Confirm the Global Admin still exists and still holds its role.

   **PARTIAL. [A]** `Users in tenant: 4` and one protected principal are consistent with
   it, but this asks for a portal check and nothing here can perform one.
8. Check for an M2M charge after the first few runs. Not on a linked subscription, since
   the External ID tenant has none, but wherever a charge would land if the premium
   add-on note in update 3 is enforced at issuance. If tokens are issuing and nothing is
   being billed, say so here and close the **[A]**.

   **OPEN.** Tokens are issuing. No billing data is reachable from the repo or from `gh`,
   so whether anything is billed for them is unknown.
9. Only after 5 through 8 does the sentence on the site become true.

   **NOT MET.** 5 is met; 6 and 8 are not. Item 5 alone is a scheduled run that deleted
   nothing, which is half the bar, and reading this item as satisfied by it is exactly
   the mistake this list exists to prevent.

---

## Not built: publishing run stats to the front end

Scoped here because it is the only monitor that tests the promise, and because spec
Module 7 already asks for it. Deliberately not implemented.

**Why it is the right monitor.** Alerting on job failure does not work. The failure that
breaks the promise is a run that never starts, and a run that never starts produces no
error. Scheduled workflows on public repos are disabled after 60 days without repository
activity **[M]**, and a disabled schedule, a deleted workflow and a lapsed credential all
look the same from outside: silence. A last-cleanup timestamp on the page inverts that.
It is visible to Steve and to a visitor, and it goes stale on its own without anything
needing to notice.

**What it would take, the static option.** Roughly a half-day.

1. The script gains a `-StatsPath` parameter and writes one JSON object: run timestamp
   in UTC, candidates found, deleted, purged, failed, and the tenant's current user
   count. **Counts only, no UPNs and no email addresses**, per "What must never be in the
   repo". A file with the identifiers of the accounts just deleted for privacy reasons
   would be its own headline.
2. The workflow writes it to `web/public/cleanup-stats.json` and commits it back to
   `main` on change. Needs `contents: write`, which is a real widening of this workflow's
   permissions and worth its own think: the job that can delete users would also be able
   to push to the branch the federated credential trusts.
3. The Module 7 page fetches it and renders "last cleanup: N hours ago", with the number
   going red past about eight hours.
4. The commit doubles as the repository activity that stops the 60-day disable. Neat, and
   slightly too neat: a job that keeps its own schedule alive by committing means the
   repo never looks quiet even if nothing else is happening.

**What it would take, the endpoint option.** A Function App endpoint reading a Table
Storage row the job writes. Cleaner separation and no `contents: write`, but it reopens
decision 006 and adds the first always-on Azure resource to a $0 hosting posture.

**Recommendation: static, with the permission question settled first.** The write-back
grant is the part that needs a decision, not the JSON. One option worth pricing: a
separate workflow, triggered by `workflow_run`, that holds `contents: write` while the
cleanup job holds only `id-token: write`. That keeps delete-users and push-to-main in
different jobs.

Decide when Module 7's page is built, not now.
