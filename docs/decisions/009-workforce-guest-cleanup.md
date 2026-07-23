# 009. Sweeping the self-service B2B guests /guest creates

**Status:** decided 22 July 2026. Code built and tested; **not yet run against the
tenant.** The verification list in section 3 is the gate, and nothing on it is met.
Until it is, `/guest` must not be live: the page tells the visitor the account
self-destructs, and today nothing deletes it.

Every factual claim is marked **[M]** if it was read in current documentation
(source and date given) or **[A]** if it is assumed and still needs testing.

Companion to [003](003-cross-tenant-graph.md), which decided how a GitHub Actions job
reaches Graph in a foreign tenant with no stored credential. That mechanism is reused
here unchanged. What this record decides is everything downstream of it.

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

**Nothing on this list is met.** The code is written and tested against synthetic users;
it has never authenticated to the workforce tenant.

The first three items cannot run until this workflow is on `main`: `workflow_dispatch`
only appears for workflows present on the default branch. So the cleanup merges **first**,
on its own, and PR #9 merges after this list is satisfied.

1. **Admin consent on `8bf3c4f7` is real.** Steve reports the three application
   permissions and the federated credential were added 22 July; neither has been
   consent-verified or exercised. **[A]** A dry run settles it: without
   `RoleManagement.Read.Directory` the run throws on `Get-MgDirectoryRole` before it
   reaches any user, which is the right direction to fail in. The portal button for
   consent has failed on a CIAM registration before and the CLI worked; see
   [003, update 2](003-cross-tenant-graph.md).
2. **The federated credential subject matches.** It must be the same immutable string as
   the External ID app registration's, `repo:steve-flanagan@234824944/theidentityplayground@1302989710:ref:refs/heads/main`
   **[M]** ([003, update 4](003-cross-tenant-graph.md)). A wrong subject saves without
   complaint and fails only at exchange, so the workflow prints the subject it presented
   before exchanging.
3. **A `workflow_dispatch` dry run authenticates and reports.** Delete unticked, which is
   the default. It must print the workforce tenant id, a **non-zero** protected-principal
   count, and a candidate breakdown. Zero protected principals means the role guard is
   not guarding, which matters more here than anywhere: the app holds
   `User.ReadWrite.All` over the whole tenant.
4. **`creationType` really reads `SelfServiceSignUp` in this tenant.** This is the
   assumption the whole rule rests on, and it is **[A]** until a run says otherwise. The
   dry run's breakdown is what settles it: a guest created through `/guest` and aged past
   the cutoff must appear as a candidate, not under "not a self-service signup". A wrong
   value here fails silently in the safe direction, which is why it needs checking rather
   than discovering.
5. **A real delete-and-purge run.** Sign up through `/guest`, wait past the TTL, dispatch
   with delete ticked, and confirm the object is gone from **Users** *and* from **Deleted
   users**. Present in Deleted users means the purge permission did not take, and a month
   of restorable PII is sitting behind a page that says otherwise. This is item 6 of 003's
   list, done again for this tenant, because a permission proven in one tenant proves
   nothing about another.
6. **`Member@theidentityplayground.com` and the Global Admin still exist**, and the admin
   still holds its role.
7. **The schedule fires unattended.** A dispatch proves the credential, not the schedule,
   and the schedule is what the site's sentence depends on.
8. **Email one-time passcode is off on the `B2X_1_B2B` user flow.** Portal, Steve. Social
   identity providers only, so mass creation costs a social account per identity instead
   of a mailbox. This is the throttle, and it is the half of the abuse story the cleanup
   does not cover. Entra ID is the default IdP on a self-service sign-up flow and cannot
   be removed; email OTP, Google, Facebook and Microsoft account are the optional ones
   **[M]**
   ([self-service-sign-up-user-flow](https://learn.microsoft.com/en-us/entra/external-id/self-service-sign-up-user-flow),
   ms.date 2026-03-27).
9. **Only after 1 through 8 does `/guest` go live**, and only then is the self-destruct
   sentence on that page true.

If item 8 changes which providers the sign-up screen offers, the copy naming them —
`Guest.tsx`, `guestMsalConfig.ts` and the Module 2 journey annotation — has to change
with it, in the same PR that flips it.
