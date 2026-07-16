#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement

<#
.SYNOPSIS
    Deletes and purges demo accounts older than a cutoff from the External ID tenant.

.DESCRIPTION
    The site tells every visitor their account self-destructs. This is the thing that
    makes that sentence true. Until it runs on a schedule, it runs from here.

    Three ideas are doing the safety work, in order of how much they matter:

    1. ALLOWLIST, NOT BLOCKLIST. A user is only ever a candidate if it can be
       positively identified as having arrived through the sign-up flow — it must
       carry an `identities` entry with a signInType this tenant issues to
       self-service signups. Anything the script cannot positively identify is
       ignored. A blocklist fails open; this fails closed.

    2. ROLE HOLDERS ARE UNTOUCHABLE. Every member of every activated directory role
       is resolved up front and excluded unconditionally, before any age check.
       This is the guard that stops the script eating the admin who runs it.

    3. NOTHING IS DELETED WITHOUT ShouldProcess. -WhatIf works. ConfirmImpact is
       High, so an unattended run prompts unless it is explicitly told not to.

    DELETE IS NOT DESTRUCTION, and that distinction is the point of the module.
    Remove-MgUser soft-deletes: the object sits in deletedItems for 30 days, fully
    restorable, with its attributes intact. A site promising accounts self-destruct
    while leaving a month of restorable PII behind would be lying in the exact place
    it claims authority. So this purges by default. Use -SkipPurge to keep the
    30-day window (useful when you want to inspect what a run actually removed).

.PARAMETER TenantId
    The External ID tenant. Defaults to The Identity Playground.

.PARAMETER MaxAgeHours
    Accounts older than this are expired. Defaults to 24, per spec section 3, Module 7.

.PARAMETER ProtectedUserPrincipalName
    Belt and braces on top of the role guard. Exact UPN matches are never touched,
    whatever their age or role.

.PARAMETER SkipPurge
    Soft-delete only. Leaves objects in deletedItems for 30 days.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -WhatIf
    The way to run it the first time. Reports exactly what would go, touches nothing.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -Confirm:$false
    Unattended. What the timer Function will do once decision 003 lands.

.NOTES
    Delegated auth on purpose: an interactive admin needs no cross-tenant Graph hop.
    Automating this from a Function in Steve's subscription DOES, because a managed
    identity is a principal in the tenant that owns the subscription, not in this
    one. That is decision 003, and it is still open. See docs/decisions/README.md.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
  [string] $TenantId = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382',

  [ValidateRange(1, 8760)]
  [int] $MaxAgeHours = 24,

  [string[]] $ProtectedUserPrincipalName = @(),

  [switch] $SkipPurge
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# signInTypes this tenant hands to self-service signups. 'emailAddress' is a local
# account; 'federated' is Google (and whatever else gets enabled later). A user with
# neither did not come through the front door and is not ours to delete.
$demoSignInTypes = @('emailAddress', 'federated')

# Least privilege. Directory.Read.All is read-only and only present to resolve role
# membership — the exclusion list is worth a read scope.
Connect-MgGraph -TenantId $TenantId `
  -Scopes 'User.ReadWrite.All', 'Directory.Read.All' `
  -NoWelcome

$context = Get-MgContext
Write-Host "Tenant : $($context.TenantId)"
Write-Host "As     : $($context.Account)"

$cutoff = (Get-Date).ToUniversalTime().AddHours(-$MaxAgeHours)
Write-Host "Cutoff : $($cutoff.ToString('u')) (older than $MaxAgeHours h)`n"

# ── Guard 1: every holder of every activated directory role ────────────────────
# Only ACTIVATED roles are returned by Get-MgDirectoryRole, which is what we want:
# a role nobody holds cannot protect anybody.
$protectedIds = [System.Collections.Generic.HashSet[string]]::new()

foreach ($role in Get-MgDirectoryRole -All) {
  foreach ($member in Get-MgDirectoryRoleMember -DirectoryRoleId $role.Id -All) {
    [void] $protectedIds.Add($member.Id)
  }
}
Write-Host "Protected by directory role: $($protectedIds.Count) principal(s)"

# ── Candidates ────────────────────────────────────────────────────────────────
# Filtering client-side rather than with -Filter on createdDateTime: on /users that
# needs advanced query parameters, and it fails in a way that returns FEWER results
# rather than an error — which on a deletion script is the wrong direction to be
# wrong in. This tenant holds tens of users; correctness beats a round trip.
$users = Get-MgUser -All -Property 'Id,DisplayName,UserPrincipalName,CreatedDateTime,Identities,UserType'

$expired = foreach ($user in $users) {

  # Guard 2: explicit allowlist.
  if ($ProtectedUserPrincipalName -contains $user.UserPrincipalName) { continue }

  # Guard 3: role holders, resolved above.
  if ($protectedIds.Contains($user.Id)) {
    Write-Verbose "Skipping $($user.UserPrincipalName): holds a directory role"
    continue
  }

  # Guard 4: positive identification. No signInType we recognise, no deletion.
  $isDemo = $false
  if ($null -ne $user.Identities) {
    foreach ($identity in $user.Identities) {
      if ($demoSignInTypes -contains $identity.SignInType) { $isDemo = $true; break }
    }
  }
  if (-not $isDemo) {
    Write-Verbose "Skipping $($user.UserPrincipalName): not a sign-up-flow account"
    continue
  }

  if ($null -eq $user.CreatedDateTime) {
    Write-Warning "Skipping $($user.UserPrincipalName): no createdDateTime, cannot age it"
    continue
  }

  if ($user.CreatedDateTime.ToUniversalTime() -lt $cutoff) { $user }
}

$expired = @($expired)

Write-Host "Users in tenant            : $($users.Count)"
Write-Host "Expired demo accounts      : $($expired.Count)`n"

if ($expired.Count -eq 0) {
  Write-Host 'Nothing to do.'
  Disconnect-MgGraph | Out-Null
  return
}

# ── Delete, then actually destroy ─────────────────────────────────────────────
$deleted = 0
$purged = 0
$failed = 0

foreach ($user in $expired) {
  $age = [math]::Round(((Get-Date).ToUniversalTime() - $user.CreatedDateTime.ToUniversalTime()).TotalHours, 1)
  $target = "$($user.UserPrincipalName) (age ${age}h)"

  if (-not $PSCmdlet.ShouldProcess($target, 'Delete and purge demo account')) { continue }

  try {
    Remove-MgUser -UserId $user.Id -ErrorAction Stop
    $deleted++

    if (-not $SkipPurge) {
      # The object is now in deletedItems, restorable for 30 days. Destroy it.
      Remove-MgDirectoryDeletedItem -DirectoryObjectId $user.Id -ErrorAction Stop
      $purged++
    }

    Write-Host "  removed  $target"
  }
  catch {
    $failed++
    Write-Warning "  FAILED   $target -- $($_.Exception.Message)"
  }
}

Write-Host "`nDeleted : $deleted"
Write-Host "Purged  : $purged$(if ($SkipPurge) { ' (skipped -- 30-day restore window left open)' })"
if ($failed -gt 0) { Write-Host "Failed  : $failed" }

Disconnect-MgGraph | Out-Null
