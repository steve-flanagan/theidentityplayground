# scripts/

Operational PowerShell against the demo tenants, using the Microsoft Graph SDK.

These run **interactively, as an admin**. That is a deliberate choice and not a
placeholder for something better: an interactive admin already holds a token in the
External ID tenant, so nothing here needs the cross-tenant Graph hop. Automating the
same work from an Azure Function *does* — a managed identity is a service principal
in the tenant that owns the subscription, which is not this tenant. That's
[decision 003](../docs/decisions/README.md), and it's still open.

So the sequence is: **script first, schedule second.** The script is what makes the
site's promise true today; the timer Function is what makes it true without Steve.

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
```

Scopes requested: `User.ReadWrite.All`, `Directory.Read.All`. The read scope exists
only to resolve directory-role membership for the exclusion list.

### Two things in it worth knowing

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

## Verify before trusting

The `signInType` values above are the assumption this script's safety rests on.
Confirm them against the tenant before the first unattended run:

```powershell
Connect-MgGraph -TenantId 7e8da8a9-67bc-4d53-bfc7-fe3e13128382 -Scopes 'User.Read.All'
Get-MgUser -All -Property 'UserPrincipalName,Identities,CreatedDateTime' |
  Select-Object UserPrincipalName, CreatedDateTime -ExpandProperty Identities |
  Format-Table SignInType, Issuer, UserPrincipalName, CreatedDateTime
```

If a real signup shows a `signInType` not in `$demoSignInTypes`, the script will
skip it forever and the accounts will quietly accumulate — the failure is silent and
in the safe direction, which is why it's worth checking rather than discovering.

## Not here yet

- Timer-triggered Function running this hourly — blocked on decision 003.
- Publishing run stats (created / deleted / current count) to the front end, per
  spec Module 7.
- B2B guest cleanup and demo-employee password rotation — Phase 2, ship with Module 2.
