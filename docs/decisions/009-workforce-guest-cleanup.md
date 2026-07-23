# 009. Sweeping the self-service B2B guests /guest creates

**Status:** decided 22 July 2026. Code built, tested, and **running against the tenant
since 23 July.** Six of the nine gate items in section 3 are met, including the one the
whole rule rested on. **The delete path itself has still never executed** (item 5), and
the schedule has not yet been seen to fire unattended (item 7), so item 9 is not met and
`/guest` is not yet earned. See the 23 July update below.

Every factual claim is marked **[M]** if it was read in current documentation
(source and date given) or **[A]** if it is assumed and still needs testing.

Companion to [003](003-cross-tenant-graph.md), which decided how a GitHub Actions job
reaches Graph in a foreign tenant with no stored credential. That mechanism is reused
here unchanged. What this record decides is everything downstream of it.

---

## Update, 23 July 2026: the first run, and the assumption it settled

PR #13 merged; a `workflow_dispatch` dry run (**29972105796**) authenticated to the
workforce tenant and reported. It worked first time — no wrong subject, no missing
consent, no token-host fallback. Verbatim:

```
Directory : Workforce
Tenant    : 9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4
As        : app 8bf3c4f7-7716-4134-8ac8-ae89e6f98d5c
Candidate : creationType SelfServiceSignUp + userType Guest
Protected by directory role: 2 principal(s)
Users in tenant            : 4
  protected by UPN         : 1
  holds a directory role   : 2
  not a self-service signup: 0
  no createdDateTime       : 0
  inside the TTL           : 1
Expired demo accounts      : 0
```

**`creationType` really does read `SelfServiceSignUp` in this tenant. [M]** That was the
**[A]** the whole rule rested on, and the breakdown is what settles it: the one guest in
the tenant appears under **inside the TTL**, which it can only reach by clearing the
identification rule first. Had the rule been wrong it would have landed under **not a
self-service signup** and the run would have printed the same `Expired demo accounts: 0`.
That ambiguity is the one the External ID sweep has never been able to resolve from its
own output, and the breakdown removed it on the first run.

The other numbers close: 1 protected UPN (`Member@`) + 2 role holders + 1 inside the TTL
= 4 users. Two protected principals, non-zero, so the role guard is guarding.

**Admin consent and the federated credential are both real. [M]** Neither needed a
separate check: `Get-MgDirectoryRole` returning 2 principals requires
`RoleManagement.Read.Directory`, and `Get-MgUser` returning 4 users requires
`User.ReadWrite.All`. A missing grant would have thrown before the run reached a user.

**A trap worth recording:**
`az ad app permission admin-consent --id 8bf3c4f7-…` returned *"Resource
'8bf3c4f7-…' does not exist or one of its queried reference-property objects are not
present"* — while consent was in fact fine. The CLI was signed in to a different tenant
(AlinaPAYGO), and `8bf3c4f7` lives in the workforce tenant, so `az` could not see it.
**The error names the app registration and blames it, for what is a tenant-context
problem.** Same shape as the misleading consent error in
[003, update 2](003-cross-tenant-graph.md): on this project, wrong answers tend to look
like a missing resource rather than a wrong question. Check `az account show` before
believing an app registration is gone.

**Item 8 is done**: email one-time passcode was dropped from the `B2X_1_B2B` user flow
(Steve, portal, 22 July). The create-account screen now offers Microsoft, GitHub and
Google, and the three pieces of site copy that name the providers were updated on PR #9.
**GitHub is on that list in the portal** despite not appearing in Microsoft's documented
IdP set for B2B self-service sign-up — observed, not explained. **[A]**

**What is still open.** The tenant's one guest is inside the TTL, so there was nothing to
delete and the delete-and-purge path has not executed here. Item 5 is unchanged, and it
is the same gate 003 took two days and one silent failure to clear in the other tenant. A
permission proven in one tenant proves nothing about another. The hourly schedule will
reach it on its own when the guest ages past 24 hours, which settles items 5 and 7
together.

---

## Context

Module 2's `/guest` creates a **real B2B guest object in the workforce tenant** on
every first-time sign-up, through the `B2X_1_B2B` self-service sign-up user flow.
`Guest.tsx` and the sign-in panel both tell the visitor the account self-destructs.
That sentence is false. The cleanup that exists ([003](003-cross-tenant-graph.md))
is External-ID-only: its workflow hard-codes tenant `7e8da8a9`, and `9e1372b0` appears
in no workflow at all.

Three things make this harder than pointing the existing job at a second tenant.

**The surface is anonymous.** Module 1's sign-up is reached from the site and creates a
customer in a CIAM tenant built for exactly that. `/guest` creates a directory object in
a *workforce* tenant, on demand, for anyone who loads the page. There is no invitation,
no approval, and nothing in the path that costs the creator anything. Whatever the sweep
does, it has to keep working when someone decides to find out what happens if they run
it a thousand times.

**The identification rule that works in CIAM is wrong here, not just unverified.** The
External ID sweep identifies candidates by `signInType`, allowing `emailAddress` and
`federated`. In a workforce tenant `federated` is also what an *invited* B2B guest
carries after redemption — a guest from another Entra org reads `ExternalAzureAD` **[M]**
([user-properties](https://learn.microsoft.com/en-us/entra/external-id/user-properties),
ms.date 2026-03-20). Reusing the rule would make hand-invited guests deletion candidates.

**The ceiling that is right in CIAM is wrong here.** 003's `-MaxDeletions` *aborts* the
run when candidates exceed the cap. On a spammable surface that means a wave of sign-ups
makes the cleanup delete **nothing**, at precisely the moment it is the only thing
between the tenant and its object quota.

---

## Decision

Four choices. The first two are about correctness, the second two about what happens
when something goes wrong.

### 1. Identify workforce candidates by `creationType` + `userType`, not `signInType`

A user in the workforce tenant is a candidate only if **`creationType` is exactly
`SelfServiceSignUp` AND `userType` is `Guest`**.

Graph documents `SelfServiceSignUp` as set for "self-service sign-up by a guest signing
up through a link that is part of a user flow" **[M]**
([user resource](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0),
ms.date 2025-01-10). That is `/guest` and nothing else in this tenant. The neighbouring
values are the accounts that must survive: an invited guest is `Invitation`, an ordinary
employee is `null`, an internal email-verified signup is `EmailVerified` **[M]**, same
page. `userType Guest` is documented for B2B collaboration users including self-service
sign-ups **[M]**
([user-properties](https://learn.microsoft.com/en-us/entra/external-id/user-properties)).

This names the *mechanism* that created the object rather than the *credential* it signs
in with, which is the property the sweep actually cares about. It is also why the two
tenants do not share a rule: `creationType` requires `$select` to retrieve **[M]**, and
an absent property reads as "not a candidate", so the failure direction stays safe.

`Member@theidentityplayground.com` cannot match — it is a native member, so
`creationType` is null and `userType` is Member — and is *also* passed to
`-ProtectedUserPrincipalName` by the workflow. It is the one account in that tenant whose
loss would be felt, and belt and braces on it costs a line.

### 2. One script, a `-Directory` switch, not a second script

`Remove-ExpiredDemoAccounts.ps1` gains `-Directory ExternalId|Workforce`. Only the
positive-identification rule branches on it. The role guard, the explicit-UPN guard, the
age check, the soft delete, the replication-lag purge retry and the ceiling are shared
code, not copied code.

### 3. `-OnCeilingExceeded TruncateOldest` for the guest sweep, `Abort` stays the default

The workforce sweep deletes **the oldest 50 per run and then fails the run**. The
External ID sweep is untouched: 10, abort, delete nothing.

The two modes encode two different readings of a surprising candidate count. Behind the
site's own sign-up, a surprising count is evidence the rule is wrong, so nothing should
be trusted to it. On an anonymous surface it is more likely to be a wave, so the sweep
drains a bounded slice and leaves the rest for the next run.

**Neither mode ever deletes some and exits 0.** A truncated run throws, naming how many
were left behind. That is the same failure this codebase has already been bitten by once,
when the first real purge failure exited 0 and reached a handoff as "unconfirmed"
([003, 22 July update](003-cross-tenant-graph.md)).

**Hourly, not six-hourly.** The TTL is still 24 hours, so this is not about catching
expiries sooner; it is drain rate. Hourly × 50 is 1,200 a day. It is free: GitHub Actions
minutes are free on public repos, and the client-credentials meter 003 worried about is
an External ID feature, so it does not apply to this tenant at all **[M]**
([external-identities-pricing](https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing),
ms.date 2026-06-22).

### 4. A separate app registration, a separate workflow, one shared token exchange

The credential is **"Guest Self-Destruct" `8bf3c4f7`** in the workforce tenant, the twin
of `demo-account-cleanup` in the External ID tenant: the same three application
permissions from 003 (`User.ReadWrite.All`, `User.DeleteRestore.All`,
`RoleManagement.Read.Directory`) and its own federated credential on this repo's `main`.
Neither credential can reach the other directory.

`.github/workflows/cleanup-guest-accounts.yml` is its own file, because the cadence, the
ceiling policy and the tenant all differ, and a failure in one tenant should not take the
other's sweep red.

The three-hop OIDC exchange is extracted to **`.github/actions/graph-token`** and used by
both. That block contains the `::add-mask::` calls that are the only thing keeping a
Graph token out of a public log, and two copies of it is two places for that to drift.

---

## Rejected alternatives

**Reuse the `signInType` allowlist across both tenants.** Rejected on correctness, not
taste: in a workforce tenant it would make invited B2B guests candidates **[M]**. It
would also import the External ID sweep's open assumption — `scripts/README.md` has
flagged the real `signInType` values as unverified since 16 July, and a rule that is
merely unproven in one tenant is a rule that is wrong in this one. Given up: a single
identification rule and a simpler script.

**A separate `Remove-ExpiredGuestAccounts.ps1`.** The tempting one, and it would read
more simply. Rejected because the guards, the purge and its replication-lag retry are the
entire argument for letting a machine delete users unattended, and they are verified by
39 tests and by a real run against the tenant. A copy is two of each, and the second is
untested on the day it is written. 003 rejected a TypeScript rewrite for the same reason
and the reasoning has not changed. Given up: the ability to change one sweep with zero
chance of touching the other. The tests are what buys that back.

**Raise the cap and keep abort.** Simpler than a second mode, and it was the first
option considered. Rejected because any fixed cap can be exceeded, and under abort
"exceeded" means "delete nothing" — so raising the number only moves where the cliff is,
it does not remove it. Given up: one ceiling story instead of two.

**Truncate quietly and exit 0.** Rejected outright. It is the exact shape of the failure
that already happened here once. Given up: a green log during a wave.

**One workflow spanning both tenants.** Rejected: different cadence, different ceiling,
and one job holding delete rights over two directories at once is a wider blast radius
for the same work. Given up: one file to look at.

**Rate-limiting `/guest` in front of Entra.** The Function App (`func-theidentityplayground`,
[006](006-standalone-function-app.md)) already has a working per-IP limiter, but the
sign-up goes browser → Entra directly and SWA is `api_location: ""`, so nothing of ours
is in that path. Putting it there means proxying an interactive redirect flow through our
own endpoint, which is a large change to a flow that is currently a real, unmodified
Entra sign-up — and that authenticity is the point of the module. Rejected for now.
**What replaces it is raising the per-identity cost instead: dropping email one-time
passcode from the `B2X_1_B2B` user flow so sign-up requires a social account.** That is a
portal change, not code, and it is item 2 of the gate below. Given up: an actual rate
limit, in exchange for keeping the demo honest.

---

## Consequences

**Push access to `main` is now user-delete in *two* tenants.** 003 said it for the CIAM
tenant; this adds the workforce one. The branch-protection ruleset on `main` is the
access control on both. Nothing about it changes, but its blast radius doubles.

**A new silent failure mode, twice.** Scheduled workflows on public repos are disabled
after 60 days with no repository activity **[M]**
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)),
and a disabled schedule raises nothing. That now takes out both sweeps at once, since
they share a repo. The monitor 003 scoped and did not build (publishing run stats to the
front end) is the only thing that catches it, and it is still not built.

**The real ceiling being defended is the tenant's directory object quota**, not the
`-MaxDeletions` number. A Microsoft Entra tenant is capped at 50,000 objects by default
**[A]** — not re-read for this record. At 1,200 removals a day the sweep drains far
faster than a human-scale abuse attempt fills, but the quota is what a sustained
automated one would be aiming at, and it is worth knowing which number actually matters.

**Unattended runs stop printing principal names, in both tenants.** A demo account's UPN
is a visitor's email address, and a scheduled run's log is a public artifact. 003 names
"deleted accounts' UPNs and email addresses in run output" as something that must never
be in the repo, and the script was doing it. Under `-AccessToken` it now logs object ids
instead. An interactive run still prints UPNs, because an admin at a console is deciding
about specific people. **This is a correction to existing behaviour, not a new feature.**

**Runs now print a skip breakdown, counts only.** The External ID sweep has never been
able to tell a zero-candidate run apart from a run whose rule matches nothing — with a
24-hour cutoff and only young accounts, both print the same zero. The breakdown
(protected / role holder / not a self-service signup / no createdDateTime / inside the
TTL) makes that distinguishable from the log alone, without naming anyone.

**The workforce tenant is a trial with an unknown expiry** ([environment.md](../../notes/environment.md)).
If it lapses, this sweep stops mattering and `/guest` stops working, in that order.

---

## The gate: verified before `/guest` goes live

**Status 23 July: 1, 2, 3, 4 and 8 are met. 5 and 7 are not, so 9 is not, and `/guest`
is not yet earned.** Item 6 is partial. Evidence is in the 23 July update above.

1. **Admin consent on `8bf3c4f7` is real.**

   **MET 23 July, run 29972105796. [M]** Not checked separately: the run read directory
   roles and users, which the two application permissions gate. A missing grant throws
   before the run reaches a user, which is the right direction to fail in.
2. **The federated credential subject matches.** It must be the same immutable string as
   the External ID app registration's **[M]** ([003, update 4](003-cross-tenant-graph.md)).
   A wrong subject saves without complaint and fails only at exchange, so the workflow
   prints the subject it presented before exchanging.

   **MET 23 July. [M]** Presented and accepted:
   `repo:steve-flanagan@234824944/theidentityplayground@1302989710:ref:refs/heads/main`,
   audience `api://AzureADTokenExchange`, token from `login.microsoftonline.com`. The
   `ciamlogin.com` fallback was not needed and is not relevant to a workforce tenant.
3. **A `workflow_dispatch` dry run authenticates and reports.** Delete unticked, which is
   the default. It must print the workforce tenant id, a **non-zero** protected-principal
   count, and a candidate breakdown. Zero protected principals means the role guard is
   not guarding, which matters more here than anywhere: the app holds
   `User.ReadWrite.All` over the whole tenant.

   **MET 23 July, run 29972105796. [M]** `Protected by directory role: 2 principal(s)`.
4. **`creationType` really reads `SelfServiceSignUp` in this tenant.** This is the
   assumption the whole rule rests on, and it is **[A]** until a run says otherwise. A
   wrong value fails silently in the safe direction, which is why it needs checking
   rather than discovering.

   **MET 23 July, run 29972105796. [M]** The tenant's one guest appears under `inside the
   TTL`, which it can only reach by clearing the identification rule first. See the 23
   July update for why that, and not the candidate count, is the discriminating
   observation.
5. **A real delete-and-purge run.** Sign up through `/guest`, wait past the TTL, and
   confirm the object is gone from **Users** *and* from **Deleted users**. Present in
   Deleted users means the purge permission did not take, and a month of restorable PII
   is sitting behind a page that says otherwise. This is item 6 of 003's list, done again
   for this tenant, because a permission proven in one tenant proves nothing about
   another — and in that tenant it took two days and one silent failure to clear.

   **OPEN.** The tenant's only guest is inside the TTL, so the first run had nothing to
   act on. The hourly schedule reaches it when it ages past 24 hours.
6. **`Member@theidentityplayground.com` and the Global Admin still exist**, and the admin
   still holds its role.

   **PARTIAL. [A]** The run reports `Member@` skipped by the explicit UPN guard and 2
   principals skipped by the role guard, which is consistent with both surviving. This
   asks for a portal check and the run cannot perform one.
7. **The schedule fires unattended.** A dispatch proves the credential, not the schedule,
   and the schedule is what the site's sentence depends on.

   **OPEN.** Settled together with item 5 by the first scheduled run that finds an aged
   guest.
8. **Email one-time passcode is off on the `B2X_1_B2B` user flow.** Social identity
   providers only, so mass creation costs a social account per identity instead of a
   mailbox. This is the throttle, and it is the half of the abuse story the cleanup does
   not cover. Entra ID is the default IdP on a self-service sign-up flow and cannot be
   removed; email OTP, Google, Facebook and Microsoft account are the optional ones **[M]**
   ([self-service-sign-up-user-flow](https://learn.microsoft.com/en-us/entra/external-id/self-service-sign-up-user-flow),
   ms.date 2026-03-27).

   **MET 22 July** (Steve, portal). Site copy naming the providers updated on PR #9.
9. **Only after 1 through 8 does `/guest` go live**, and only then is the self-destruct
   sentence on that page true.

   **NOT MET, gated on 5 and 7 alone.** The rule, the credential and the guards are
   proven against the real tenant; what is unproven is that the thing actually deletes.

If item 8 changes which providers the sign-up screen offers, the copy naming them —
`Guest.tsx`, `guestMsalConfig.ts` and the Module 2 journey annotation — has to change
with it. Done 23 July on PR #9: all three now read Microsoft, GitHub and Google.
