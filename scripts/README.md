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

Deletes and purges sign-up-flow accounts older than 24 hours from the External ID
tenant.

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
```

Scopes requested: `User.ReadWrite.All`, `Directory.Read.All`. The read scope exists
only to resolve directory-role membership for the exclusion list. Under `-AccessToken`
the scopes are inert, since the token already carries the consented application
permissions.

### Three things in it worth knowing

**It allowlists rather than blocklists.** A user is a deletion candidate only if it
can be *positively* identified as having arrived through the sign-up flow — it must
carry an `identities` entry whose `signInType` is one this tenant issues to
self-service signups (`emailAddress` for local accounts, `federated` for Google).
Anything unrecognised is skipped. A blocklist fails open; this fails closed. On top
of that, every member of every activated directory role is excluded unconditionally
before any age check, which is the guard that stops it eating the admin running it.

**Delete is not destruction.** `Remove-MgUser` soft-deletes — the object sits in
`deletedItems` for 30 days, fully restorable, attributes intact. A site that promises
accounts self-destruct while leaving a month of restorable PII behind is lying in the
one place it claims authority, so this purges by default via
`Remove-MgDirectoryDeletedItem`. `-SkipPurge` opts out.

**There is a ceiling, and it aborts rather than truncates.** The scheduled run passes
`-Confirm:$false`, which removes `ShouldProcess` as a guard. `-MaxDeletions` (default
10) puts a cap back: if the candidate count exceeds it, the run stops and deletes
**nothing**. A cap that deleted up to the limit and stopped would half-work silently,
emptying the tenant over successive runs while every run looked fine.

## Tests

```powershell
./Remove-ExpiredDemoAccounts.Tests.ps1
```

No Pester, no network, no tenant. Twenty-two cases against synthetic users under
`Set-StrictMode -Version Latest`, covering the four guards, the purge and its
replication-lag retry, `-WhatIf`, both auth paths, and the ceiling. Exits non-zero on
failure.

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
selected; exceeding the ceiling deletes nothing.

**Verified against the live tenant, 20 July 2026.** The token exchange, the federated
credential subject, and the token endpoint host all worked first time, across a dispatch
dry run and a scheduled run. See decision 003.

**NOT verified: the delete path.** Both runs found zero expired accounts, so
`Remove-MgUser` and `Remove-MgDirectoryDeletedItem` have never been reached outside the
tests. Auth, the permission read path, the role guard and the "nothing to do" branch are
proven. Deletion is not.

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
in the safe direction, which is why it's worth checking rather than discovering.

## Scheduled runs

`.github/workflows/cleanup-demo-accounts.yml` runs this every six hours against the
External ID tenant. No stored credential: GitHub mints an OIDC token for the workflow,
Entra trades it for an app-only Graph token through a federated identity credential.

**Manual runs are `-WhatIf` by default.** Actually deleting takes an explicit tick of
the `delete` input on the Actions tab.

## Not here yet

- Publishing run stats (created / deleted / current count) to the front end, per
  spec Module 7. Scoped in decision 003, not built. It is also the only monitor that
  catches the workflow silently not running.
- B2B guest cleanup and demo-employee password rotation — Phase 2, ship with Module 2.
