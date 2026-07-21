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

    4. A CEILING, because idea 3 goes away under automation. -Confirm:$false is
       how the scheduled run works, and it removes ShouldProcess as a guard.
       -MaxDeletions puts a cap back. It ABORTS the run when the candidate count
       exceeds it, rather than deleting up to the limit and stopping: a cap that
       truncates half-works silently, which is a worse failure than not running.

    DELETE IS NOT DESTRUCTION, and that distinction is the point of the module.
    Remove-MgUser soft-deletes: the object sits in deletedItems for 30 days, fully
    restorable, with its attributes intact. A site promising accounts self-destruct
    while leaving a month of restorable PII behind would be lying in the exact place
    it claims authority. So this purges by default, and because the purge can briefly
    outrun the directory replicating the soft delete into deletedItems, it retries the
    Request_ResourceNotFound that race produces rather than leaving the object behind.
    Use -SkipPurge to keep the 30-day window (useful when you want to inspect what a
    run actually removed).

.PARAMETER TenantId
    The External ID tenant. Defaults to The Identity Playground.

.PARAMETER MaxAgeHours
    Accounts older than this are expired. Defaults to 24, per spec section 3, Module 7.

.PARAMETER ProtectedUserPrincipalName
    Belt and braces on top of the role guard. Exact UPN matches are never touched,
    whatever their age or role.

.PARAMETER SkipPurge
    Soft-delete only. Leaves objects in deletedItems for 30 days.

.PARAMETER PurgeRetryDelaySeconds
    Seconds to wait between purge attempts. The soft delete and the purge are two
    writes against an eventually consistent directory: the object the soft delete
    puts in deletedItems may not have replicated to the node the purge lands on yet,
    and a purge that outruns it comes back Request_ResourceNotFound. That 404 is
    retried, up to six attempts, waiting this long between each. Tests pass 0 so they
    do not sleep. Default 10.

.PARAMETER MaxDeletions
    Ceiling on candidates per run. Exceeding it aborts and deletes nothing.

    Default 10. With a 24-hour TTL and a six-hourly schedule, a run only ever sees
    the accounts that crossed 24 hours inside that window, so ten is already well
    above a normal day on this site. The number this is defending against is not
    eleven, it is "every user in the tenant", which is what a wrong
    $demoSignInTypes or a change to the signInType values Entra issues would
    produce. Raise it explicitly for a known backlog; that is a human decision and
    it should read like one in the run log.

.PARAMETER AccessToken
    App-only Graph token, for the scheduled run. Without it the script signs in
    interactively, which is what an admin at a console wants. See decision 003.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -WhatIf
    The way to run it the first time. Reports exactly what would go, touches nothing.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -Confirm:$false
    Unattended, interactive credential.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -AccessToken $token -Confirm:$false
    What .github/workflows/cleanup-demo-accounts.yml runs.

.NOTES
    Two auth paths, one file. Interactive delegated auth for an admin at a console,
    who needs no cross-tenant hop. App-only via -AccessToken for GitHub Actions,
    which does: a managed identity is a principal in the tenant that owns the
    subscription, not in this one. That is decision 003, and it is decided.
    See docs/decisions/003-cross-tenant-graph.md.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
  [string] $TenantId = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382',

  [ValidateRange(1, 8760)]
  [int] $MaxAgeHours = 24,

  [string[]] $ProtectedUserPrincipalName = @(),

  [switch] $SkipPurge,

  [ValidateRange(0, 300)]
  [int] $PurgeRetryDelaySeconds = 10,

  [ValidateRange(1, 10000)]
  [int] $MaxDeletions = 10,

  [System.Security.SecureString] $AccessToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# signInTypes this tenant hands to self-service signups. 'emailAddress' is a local
# account; 'federated' is Google (and whatever else gets enabled later). A user with
# neither did not come through the front door and is not ours to delete.
$demoSignInTypes = @('emailAddress', 'federated')

if ($PSBoundParameters.ContainsKey('AccessToken')) {
  # App-only. The token already carries the tenant and the application permissions
  # an admin consented to, so -TenantId and -Scopes are neither accepted nor
  # meaningful here: the AccessToken parameter set takes AccessToken, Environment,
  # ClientTimeout, NoWelcome and Break, and nothing else. Asking for a scope the
  # token does not have would not add it. If RoleManagement.Read.Directory is
  # missing, Get-MgDirectoryRole throws, $ErrorActionPreference stops the run, and
  # nothing is deleted. That is the direction to fail in.
  Connect-MgGraph -AccessToken $AccessToken -NoWelcome
}
else {
  # Least privilege. Directory.Read.All is read-only and only present to resolve
  # role membership. The exclusion list is worth a read scope.
  Connect-MgGraph -TenantId $TenantId `
    -Scopes 'User.ReadWrite.All', 'Directory.Read.All' `
    -NoWelcome
}

$context = Get-MgContext
Write-Host "Tenant : $($context.TenantId)"
# Account is null under app-only auth, so fall back to the app the token was for.
Write-Host "As     : $(if ($context.Account) { $context.Account } else { "app $($context.ClientId)" })"

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

# ── Ceiling: abort, never truncate ────────────────────────────────────────────
# The scheduled run passes -Confirm:$false, which removes ShouldProcess as a
# guard. This puts a cap back in its place.
#
# It aborts rather than deleting the first $MaxDeletions and stopping. A cap that
# truncates would delete ten users and exit 0, and the run that follows would
# delete ten more, so a broken allowlist would empty the tenant on a schedule
# while every run looked successful. Aborting turns that into one loud failure
# with nothing lost.
#
# This fires under -WhatIf too. A dry run is supposed to tell you what the real
# run would do, and what the real run would do is stop.
if ($expired.Count -gt $MaxDeletions) {
  $message = @(
    "Aborted: $($expired.Count) candidates exceeds the -MaxDeletions ceiling of $MaxDeletions."
    'Nothing was deleted.'
    'A count this high usually means $demoSignInTypes no longer matches what the tenant issues.'
    "Check the candidates with -WhatIf, then re-run with -MaxDeletions $($expired.Count) if they are correct."
  ) -join ' '

  Disconnect-MgGraph | Out-Null
  throw $message
}

# ── Delete, then actually destroy ─────────────────────────────────────────────
# Soft delete and purge are two writes against an eventually consistent directory.
# The object a soft delete puts in deletedItems may not have replicated to the node
# the purge lands on yet, and a purge that outruns that replication gets
# Request_ResourceNotFound -- a 404 on an object that exists but is not visible here
# yet, not a wrong id and not a missing permission (either of those is a 403). The
# documented remedy for this 404 is wait-and-retry, so the purge retries on that one
# error, bounded. See scripts/README.md.
$purgeMaxAttempts = 6

$deleted  = 0   # soft-deleted, whatever happened next
$purged   = 0   # and destroyed out of deletedItems
$unpurged = 0   # soft-deleted, but the purge did not complete -- still restorable
$failed   = 0   # the soft delete itself failed -- the account is untouched

foreach ($user in $expired) {
  $age = [math]::Round(((Get-Date).ToUniversalTime() - $user.CreatedDateTime.ToUniversalTime()).TotalHours, 1)
  $target = "$($user.UserPrincipalName) (age ${age}h)"

  if (-not $PSCmdlet.ShouldProcess($target, 'Delete and purge demo account')) { continue }

  # Soft delete. If this throws the account is untouched, which is a real failure
  # and the only thing that belongs in $failed.
  try {
    Remove-MgUser -UserId $user.Id -ErrorAction Stop
    $deleted++
  }
  catch {
    $failed++
    Write-Warning "  FAILED   $target -- soft delete failed: $($_.Exception.Message)"
    continue
  }

  if ($SkipPurge) {
    Write-Host "  removed  $target (soft delete only)"
    continue
  }

  # Purge, tolerating replication lag. Only Request_ResourceNotFound is retried; any
  # other error is genuine and is reported at once without burning the attempts.
  $purgedThis = $false
  for ($attempt = 1; $attempt -le $purgeMaxAttempts; $attempt++) {
    try {
      Remove-MgDirectoryDeletedItem -DirectoryObjectId $user.Id -ErrorAction Stop
      $purgedThis = $true
      break
    }
    catch {
      $isLag = $_.Exception.Message -match 'Request_ResourceNotFound'
      if ($isLag -and $attempt -lt $purgeMaxAttempts) {
        Start-Sleep -Seconds $PurgeRetryDelaySeconds
        continue
      }
      $why = if ($isLag) { "still 404 after $purgeMaxAttempts attempts, replication lag" }
             else { $_.Exception.Message }
      Write-Warning "  PARTIAL  $target -- soft-deleted but NOT purged: $why"
      break
    }
  }

  if ($purgedThis) {
    $purged++
    Write-Host "  removed  $target"
  }
  else {
    $unpurged++
  }
}

Write-Host "`nDeleted : $deleted"
Write-Host "Purged  : $purged$(if ($SkipPurge) { ' (skipped -- 30-day restore window left open)' })"
if ($unpurged -gt 0) { Write-Host "Not purged, still restorable : $unpurged" }
if ($failed -gt 0) { Write-Host "Soft-delete failures         : $failed" }

Disconnect-MgGraph | Out-Null

# A purge that did not complete leaves restorable PII behind a page that says the
# account is gone; a soft-delete failure leaves a live expired account. Either one
# has to make the run fail loudly instead of exiting 0. A silent green run is how the
# first real purge failure reached a handoff that called it "unconfirmed".
if ($unpurged -gt 0 -or $failed -gt 0) {
  throw "Completed with problems: $failed soft-delete failure(s), $unpurged soft-deleted but not purged (still restorable). See the warnings above."
}
