# scripts/

Operational PowerShell against the demo tenants, using the Microsoft Graph SDK.

These run **interactively, as an admin**, and the cleanup also runs unattended from
GitHub Actions. An interactive admin already holds a token in the External ID tenant,
so nothing here needs the cross-tenant Graph hop. Automating the same work does, and
[decision 003](../docs/decisions/003-cross-tenant-graph.md) is how: an app registration
in the External ID tenant, a federated credential trusting this repo, and no stored
secret anywhere.

One file serves both. `-AccessToken` switches it to app-only; without it the script
signs in interactively.

## Setup

```powershell
Install-Module Microsoft.Graph -Scope CurrentUser
```

## Remove-ExpiredDemoAccounts.ps1

Deletes and purges self-service accounts older than 24 hours. **Two tenants, one
script**: `-Directory ExternalId` (the default) sweeps the customers Module 1
creates in the CIAM tenant; `-Directory Workforce` sweeps the B2B guests `/guest`
creates in the workforce tenant. Everything except which users are candidates is
shared code — the guards, the purge, the replication-lag retry and the ceiling.
[Decision 009](../docs/decisions/009-workforce-guest-cleanup.md) is why it is one
file rather than two.

```powershell
# First run, always. Reports what would go; touches nothing.
./Remove-ExpiredDemoAccounts.ps1 -WhatIf

# Interactive. Prompts per account (ConfirmImpact is High).
./Remove-ExpiredDemoAccounts.ps1

# Unattended.
./Remove-ExpiredDemoAccounts.ps1 -Confirm:$false

# Keep the 30-day restore window, e.g. to inspect a run afterwards.
./Remove-ExpiredDemoAccounts.ps1 -SkipPurge

# Raise the ceiling for a known backlog. Deliberately not something you set once
# and forget: the run log should show a human decided this.
./Remove-ExpiredDemoAccounts.ps1 -MaxDeletions 40 -Confirm:$false

# The /guest sweep, dry. -Directory also picks the tenant, so nothing else needed.
./Remove-ExpiredDemoAccounts.ps1 -Directory Workforce -WhatIf

# The /guest sweep as the workflow runs it: drain the oldest 50 and fail loudly
# if a wave left more behind.
./Remove-ExpiredDemoAccounts.ps1 -Directory Workforce -MaxDeletions 50 `
  -OnCeilingExceeded TruncateOldest `
  -ProtectedUserPrincipalName 'Member@theidentityplayground.com' -Confirm:$false
```

Scopes requested: `User.ReadWrite.All`, `Directory.Read.All`. The read scope exists
only to resolve directory-role membership for the exclusion list. Under `-AccessToken`
the scopes are inert, since the token already carries the consented application
permissions.

### Four things in it worth knowing

**It allowlists rather than blocklists.** A user is a deletion candidate only if it
can be *positively* identified as a self-service sign-up. Anything unrecognised is
skipped. A blocklist fails open; this fails closed. On top of that, every member of
every activated directory role is excluded unconditionally before any age check,
which is the guard that stops it eating the admin running it.

The identification rule is the one thing that differs by tenant:

| `-Directory` | A candidate is | Why not the other rule |
|---|---|---|
| `ExternalId` | an `identities` entry whose `signInType` is one this tenant issues to self-service signups (`emailAddress` for local accounts, `federated` for Google) | `creationType` is a CIAM-tenant local account there, not a guest sign-up |
| `Workforce` | `creationType` is exactly `SelfServiceSignUp` **and** `userType` is `Guest` | `signInType federated` also describes an *invited* B2B guest, so the CIAM rule would make hand-invited guests candidates |

`creationType` names the mechanism that created the object rather than the
credential it signs in with, and Graph sets `SelfServiceSignUp` only for a guest
that came through a user-flow link — which is `/guest` and nothing else.

**Unattended runs print no principal names.** A demo account's UPN is a visitor's
email address and the scheduled run's log is public, so under `-AccessToken` the
script logs object ids instead. An interactive run still prints UPNs: an admin at a
console is deciding about specific people. Every run also prints a skip breakdown,
counts only — which is what tells a zero-candidate run apart from a run whose rule
matches nothing.

**Delete is not destruction.** `Remove-MgUser` soft-deletes — the object sits in
`deletedItems` for 30 days, fully restorable, attributes intact. A site that promises
accounts self-destruct while leaving a month of restorable PII behind is lying in the
one place it claims authority, so this purges by default via
`Remove-MgDirectoryDeletedItem`. `-SkipPurge` opts out.

**There is a ceiling, and what hitting it means depends on the tenant.** The
scheduled run passes `-Confirm:$false`, which removes `ShouldProcess` as a guard.
`-MaxDeletions` puts a cap back, and `-OnCeilingExceeded` decides what exceeding it
does.

`Abort` (default, 10) deletes **nothing**. Behind the site's own sign-up, a
surprising candidate count is evidence the rule is wrong, so nothing is trusted to
it. `TruncateOldest` (the `/guest` sweep, 50) deletes the oldest 50 and leaves the
rest. `/guest` is anonymous, so a surprising count there is more likely a wave, and
aborting would delete nothing at exactly the moment the sweep is what stands between
the tenant and its object quota.

**Neither mode ever deletes some and exits 0.** A truncated run throws, naming how
many were left behind. A cap that half-worked silently would empty a tenant over
successive runs while every run looked fine.

## Tests

```powershell
./Remove-ExpiredDemoAccounts.Tests.ps1
```

No Pester, no network, no tenant. Thirty-nine cases against synthetic users under
`Set-StrictMode -Version Latest`, covering the four guards, the purge and its
replication-lag retry, `-WhatIf`, both auth paths, both ceiling modes, both
identification rules, and what an unattended run prints. Exits non-zero on failure.

`-ScriptPath` points it at a different copy of the script, which is how a test gets
checked for actually discriminating:

```powershell
git show HEAD~1:scripts/Remove-ExpiredDemoAccounts.ps1 > /tmp/old.ps1
./Remove-ExpiredDemoAccounts.Tests.ps1 -ScriptPath /tmp/old.ps1
```

## What's verified, and what isn't

**Verified against Graph SDK 2.38.1** (16 July): every cmdlet, parameter and object
property the script touches resolves — `Connect-MgGraph`, `Get-MgUser`,
`Remove-MgUser`, `Get-MgDirectoryRole`, `Get-MgDirectoryRoleMember`,
`Remove-MgDirectoryDeletedItem`, and the `.Identities[].SignInType` /
`.CreatedDateTime` reads.

**Verified by test**: the guard logic and the ceiling, by the file above. A 999-hour-old
role-holding admin is skipped; a user with no `identities` is skipped; a guest whose
`signInType` is `userPrincipalName` is skipped; only the aged sign-up-flow accounts are
selected; exceeding the ceiling deletes nothing. Under `-Directory Workforce`, an
invited guest, an ordinary employee, an `EmailVerified` internal signup and a
self-service guest whose `userType` was flipped to Member are all skipped; the two
rules are checked in both directions for not leaking into each other; a truncating
run takes the oldest and still fails; and an app-only run's output is asserted to
carry object ids and no principal names. Confirmed to fail against the pre-change
script (15 of them), so they discriminate.

**Verified against the live tenant, 20 July 2026.** The token exchange, the federated
credential subject, and the token endpoint host all worked first time, across a dispatch
dry run and a scheduled run. See decision 003.

**Verified against the tenant, 22 July 2026.** An app-only scheduled/dispatch run removed
and purged 3 expired accounts end-to-end (`Deleted: 3`, `Purged: 3`, run 29880436817). The
first run to reach this path soft-deleted but failed to purge on an Entra replication-lag
404 (`Request_ResourceNotFound`); the purge now retries that transient 404 and fails the
run loudly if anything is left unpurged. See decision 003's 22 July update.

**NOT verified, needs the tenant, and it is the assumption everything rests on:**
the real `signInType` values. The two runs cannot settle this. With a 24-hour cutoff and
only young accounts, "no aged accounts" and "signInType never matched" print the same
zero. Confirm directly:

```powershell
Connect-MgGraph -TenantId 7e8da8a9-67bc-4d53-bfc7-fe3e13128382 -Scopes 'User.Read.All'
Get-MgUser -All -Property 'UserPrincipalName,Identities,CreatedDateTime' |
  Select-Object UserPrincipalName, CreatedDateTime -ExpandProperty Identities |
  Format-Table SignInType, Issuer, UserPrincipalName, CreatedDateTime
```

If a real signup shows a `signInType` not in `$demoSignInTypes`, the script will
skip it forever and the accounts will quietly accumulate — the failure is silent and
in the safe direction, which is why it's worth checking rather than discovering. The
skip breakdown a run now prints is the cheaper version of this check: "not a
self-service signup" equal to the tenant's whole user count is the same finding.

**NOT verified at all: the workforce sweep.** `-Directory Workforce` has never
authenticated to tenant `9e1372b0`. Its rule is documented rather than observed —
Graph's own definition of `creationType SelfServiceSignUp` — and whether this tenant
actually sets it is **[A]**. The gate is section 3 of
[decision 009](../docs/decisions/009-workforce-guest-cleanup.md), and none of it is met.

## Scheduled runs

| Workflow | Tenant | Cadence | Ceiling |
|---|---|---|---|
| [cleanup-demo-accounts.yml](../.github/workflows/cleanup-demo-accounts.yml) | External ID `7e8da8a9` | every 6 h | 10, abort |
| [cleanup-guest-accounts.yml](../.github/workflows/cleanup-guest-accounts.yml) | workforce `9e1372b0` | hourly | 50, truncate oldest |

No stored credential in either: GitHub mints an OIDC token for the run and Entra
trades it for an app-only Graph token through a federated identity credential. The
exchange is one shared composite action,
[.github/actions/graph-token](../.github/actions/graph-token/action.yml) — it holds the
`::add-mask::` calls that keep the token out of a public log, and one copy is the point.

**Manual runs are `-WhatIf` by default** in both. Actually deleting takes an explicit
tick of the `delete` input on the Actions tab.

## Not here yet

- Publishing run stats (created / deleted / current count) to the front end, per
  spec Module 7. Scoped in decision 003, not built. It is also the only monitor that
  catches either workflow silently not running — and they now share a repo, so the
  60-day inactivity disable takes out both at once.
- Demo-employee password rotation — Phase 2.
