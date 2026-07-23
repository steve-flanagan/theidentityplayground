#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement

<#
.SYNOPSIS
    Deletes and purges demo accounts older than a cutoff from a demo tenant.

.DESCRIPTION
    The site tells every visitor their account self-destructs. This is the thing that
    makes that sentence true. Until it runs on a schedule, it runs from here.

    TWO TENANTS, ONE SCRIPT. -Directory picks which. The External ID tenant holds
    the customers Module 1 creates; the workforce tenant holds the B2B guests /guest
    creates. Everything after "which users are candidates" is identical, so the
    guards, the purge and the ceiling are shared rather than copied. What differs is
    only the positive-identification rule, and that is the one thing each tenant has
    to answer for itself.

    Three ideas are doing the safety work, in order of how much they matter:

    1. ALLOWLIST, NOT BLOCKLIST. A user is only ever a candidate if it can be
       positively identified as having arrived through a self-service sign-up.
       Anything the script cannot positively identify is ignored. A blocklist fails
       open; this fails closed. The rule per directory:

       ExternalId — an `identities` entry whose signInType is one this tenant
       issues to self-service signups.

       Workforce — `creationType` is exactly `SelfServiceSignUp` AND `userType` is
       `Guest`. Graph sets creationType to SelfServiceSignUp only for "a guest
       signing up through a link that is part of a user flow", which is precisely
       and only what /guest produces. An invited B2B guest reads `Invitation`, an
       ordinary employee reads null, and neither is ever a candidate. This is a
       stronger identifier than signInType because it names the mechanism rather
       than the credential.

    2. ROLE HOLDERS ARE UNTOUCHABLE. Every member of every activated directory role
       is resolved up front and excluded unconditionally, before any age check.
       This is the guard that stops the script eating the admin who runs it.

    3. NOTHING IS DELETED WITHOUT ShouldProcess. -WhatIf works. ConfirmImpact is
       High, so an unattended run prompts unless it is explicitly told not to.

    4. A CEILING, because idea 3 goes away under automation. -Confirm:$false is
       how the scheduled run works, and it removes ShouldProcess as a guard.
       -MaxDeletions puts a cap back, and -OnCeilingExceeded decides what hitting
       it means.

       Abort (the default) deletes NOTHING. That is right when the tenant is only
       reachable behind a sign-up the site links to, because a surprising candidate
       count there means the allowlist is wrong, and a cap that truncated would
       half-work silently while emptying the tenant over successive runs.

       TruncateOldest deletes the oldest -MaxDeletions and fails the run loudly.
       That is right on an anonymously spammable surface, where the surprising
       count is more likely to be a spam wave than a broken allowlist — and where
       aborting would delete nothing at exactly the moment the cleanup is the thing
       standing between the tenant and its object quota. It still fails the run, so
       "the ceiling was hit" never reads as a clean pass.

    5. NO PRINCIPAL NAMES IN AN UNATTENDED RUN'S OUTPUT. A demo account's UPN is a
       visitor's email address, and the unattended run's output is a public GitHub
       Actions log. Under -AccessToken the script logs object ids instead, which
       identify the object for debugging without publishing who it belonged to. An
       interactive run still prints UPNs: an admin at a console is deciding whether
       to delete these specific people and needs to see them.

    DELETE IS NOT DESTRUCTION, and that distinction is the point of the module.
    Remove-MgUser soft-deletes: the object sits in deletedItems for 30 days, fully
    restorable, with its attributes intact. A site promising accounts self-destruct
    while leaving a month of restorable PII behind would be lying in the exact place
    it claims authority. So this purges by default, and because the purge can briefly
    outrun the directory replicating the soft delete into deletedItems, it retries the
    Request_ResourceNotFound that race produces rather than leaving the object behind.
    Use -SkipPurge to keep the 30-day window (useful when you want to inspect what a
    run actually removed).

.PARAMETER Directory
    Which demo tenant, and therefore which positive-identification rule.

    ExternalId (default) — the CIAM tenant behind Module 1's sign-up. Candidates are
    identified by signInType.

    Workforce — the tenant behind /guest. Candidates are identified by
    creationType + userType.

    It also picks the default -TenantId, so an interactive run is
    `-Directory Workforce` and nothing else.

.PARAMETER TenantId
    The tenant to sign in to interactively. Defaults to whichever tenant -Directory
    names. Inert under -AccessToken: the token already says which tenant it is for.

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
    Ceiling on candidates per run. What exceeding it does is -OnCeilingExceeded.

    Default 10. With a 24-hour TTL and a six-hourly schedule, a run only ever sees
    the accounts that crossed 24 hours inside that window, so ten is already well
    above a normal day on this site. The number this is defending against is not
    eleven, it is "every user in the tenant", which is what a wrong
    $demoSignInTypes or a change to the signInType values Entra issues would
    produce. Raise it explicitly for a known backlog; that is a human decision and
    it should read like one in the run log.

.PARAMETER OnCeilingExceeded
    What happens when the candidate count exceeds -MaxDeletions.

    Abort (default) — delete nothing and throw. The count is treated as evidence
    that the allowlist is wrong, and nothing is trusted to it.

    TruncateOldest — delete the oldest -MaxDeletions, then throw. The count is
    treated as a backlog to drain, and the run still fails so nobody reads a
    truncated run as a clean one. This is for /guest, where the surface is
    anonymous and a wave of sign-ups is a thing that can genuinely happen; an
    abort there would stop deleting at exactly the wrong moment.

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

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -Directory Workforce -WhatIf
    The /guest sweep, dry. Reports which self-service B2B guests would go.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.ps1 -Directory Workforce -AccessToken $token `
      -MaxDeletions 50 -OnCeilingExceeded TruncateOldest `
      -ProtectedUserPrincipalName 'Member@theidentityplayground.com' -Confirm:$false
    What .github/workflows/cleanup-guest-accounts.yml runs.

.NOTES
    Two auth paths, one file. Interactive delegated auth for an admin at a console,
    who needs no cross-tenant hop. App-only via -AccessToken for GitHub Actions,
    which does: a managed identity is a principal in the tenant that owns the
    subscription, not in this one. That is decision 003, and it is decided.
    See docs/decisions/003-cross-tenant-graph.md.
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
  [ValidateSet('ExternalId', 'Workforce')]
  [string] $Directory = 'ExternalId',

  [string] $TenantId,

  [ValidateRange(1, 8760)]
  [int] $MaxAgeHours = 24,

  [string[]] $ProtectedUserPrincipalName = @(),

  [switch] $SkipPurge,

  [ValidateRange(0, 300)]
  [int] $PurgeRetryDelaySeconds = 10,

  [ValidateRange(1, 10000)]
  [int] $MaxDeletions = 10,

  [ValidateSet('Abort', 'TruncateOldest')]
  [string] $OnCeilingExceeded = 'Abort',

  [System.Security.SecureString] $AccessToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Public identifiers, both of them. See notes/environment.md.
$defaultTenantIds = @{
  ExternalId = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382'
  Workforce  = '9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4'
}
if (-not $TenantId) { $TenantId = $defaultTenantIds[$Directory] }

# signInTypes the External ID tenant hands to self-service signups. 'emailAddress' is
# a local account; 'federated' is Google (and whatever else gets enabled later). A
# user with neither did not come through the front door and is not ours to delete.
$demoSignInTypes = @('emailAddress', 'federated')

# The workforce rule. creationType is documented as SelfServiceSignUp only for "a
# guest signing up through a link that is part of a user flow" -- the B2X_1_B2B flow
# /guest sends visitors to, and nothing else in this tenant. Pairing it with
# userType Guest costs nothing and means a single wrong property cannot widen the
# net on its own.
$guestCreationType = 'SelfServiceSignUp'
$guestUserType     = 'Guest'

# UPNs are email addresses and the unattended run's log is public. See idea 5.
$redactPrincipalNames = $PSBoundParameters.ContainsKey('AccessToken')

function Get-PrincipalLabel {
  <#
    What a user is called in this run's output. The object id under app-only auth,
    which is enough to find the object again and is not somebody's email address.
  #>
  param($User)
  if ($redactPrincipalNames) { "object $($User.Id)" } else { $User.UserPrincipalName }
}

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
Write-Host "Directory : $Directory"
Write-Host "Tenant    : $($context.TenantId)"
# Account is null under app-only auth, so fall back to the app the token was for.
Write-Host "As        : $(if ($context.Account) { $context.Account } else { "app $($context.ClientId)" })"

# The rule this run is about to apply, printed because a run that finds nothing and a
# run whose rule matches nothing produce the same zero.
Write-Host "Candidate : $(if ($Directory -eq 'Workforce')
                          { "creationType $guestCreationType + userType $guestUserType" }
                          else { "signInType in $($demoSignInTypes -join ', ')" })"

$cutoff = (Get-Date).ToUniversalTime().AddHours(-$MaxAgeHours)
Write-Host "Cutoff    : $($cutoff.ToString('u')) (older than $MaxAgeHours h)`n"

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
#
# CreationType has to be in the $select or Graph does not return it at all, and an
# absent property reads as "not a self-service guest" — a silent skip-everything in
# the safe direction, which is the hardest kind of wrong to notice.
$users = Get-MgUser -All -Property 'Id,DisplayName,UserPrincipalName,CreatedDateTime,Identities,UserType,CreationType'

# Counts only, never names. This is the number that tells a zero-candidate run apart
# from a run whose identification rule matches nothing, which is the failure the
# External ID sweep has never been able to rule out from its own output.
$skipped = [ordered]@{ Protected = 0; RoleHolder = 0; NotSelfService = 0; NoCreatedDate = 0; InsideTtl = 0 }

$expired = foreach ($user in $users) {

  # Guard 2: explicit allowlist.
  if ($ProtectedUserPrincipalName -contains $user.UserPrincipalName) {
    $skipped.Protected++
    continue
  }

  # Guard 3: role holders, resolved above.
  if ($protectedIds.Contains($user.Id)) {
    $skipped.RoleHolder++
    Write-Verbose "Skipping $(Get-PrincipalLabel $user): holds a directory role"
    continue
  }

  # Guard 4: positive identification, and the only guard that differs by tenant.
  $isDemo = if ($Directory -eq 'Workforce') {
    # A guest that came through the B2X_1_B2B user flow, and nothing else. An
    # invited guest is 'Invitation', an employee is null, and userType pins it to
    # a guest object either way.
    $user.CreationType -eq $guestCreationType -and $user.UserType -eq $guestUserType
  }
  else {
    $matched = $false
    if ($null -ne $user.Identities) {
      foreach ($identity in $user.Identities) {
        if ($demoSignInTypes -contains $identity.SignInType) { $matched = $true; break }
      }
    }
    $matched
  }

  if (-not $isDemo) {
    $skipped.NotSelfService++
    Write-Verbose "Skipping $(Get-PrincipalLabel $user): not a self-service sign-up"
    continue
  }

  if ($null -eq $user.CreatedDateTime) {
    $skipped.NoCreatedDate++
    Write-Warning "Skipping $(Get-PrincipalLabel $user): no createdDateTime, cannot age it"
    continue
  }

  if ($user.CreatedDateTime.ToUniversalTime() -lt $cutoff) { $user }
  else { $skipped.InsideTtl++ }
}

$expired = @($expired)

Write-Host "Users in tenant            : $($users.Count)"
Write-Host "  protected by UPN         : $($skipped.Protected)"
Write-Host "  holds a directory role   : $($skipped.RoleHolder)"
Write-Host "  not a self-service signup: $($skipped.NotSelfService)"
Write-Host "  no createdDateTime       : $($skipped.NoCreatedDate)"
Write-Host "  inside the TTL           : $($skipped.InsideTtl)"
Write-Host "Expired demo accounts      : $($expired.Count)`n"

if ($expired.Count -eq 0) {
  Write-Host 'Nothing to do.'
  Disconnect-MgGraph | Out-Null
  return
}

# ── Ceiling ───────────────────────────────────────────────────────────────────
# The scheduled run passes -Confirm:$false, which removes ShouldProcess as a
# guard. This puts a cap back in its place.
#
# Neither mode ever deletes up to the limit and exits 0. That is the failure both
# are written to avoid: a run that half-works and reports success would let a
# broken allowlist empty a tenant on a schedule with every run looking fine.
# Abort deletes nothing and throws; TruncateOldest drains a bounded slice and
# still throws. What differs is only whether the overflow is treated as evidence
# of a bug (abort) or as a backlog (truncate).
#
# Both fire under -WhatIf. A dry run is supposed to tell you what the real run
# would do, and in both modes what the real run would do is fail.
$overflow = 0

if ($expired.Count -gt $MaxDeletions) {
  if ($OnCeilingExceeded -eq 'Abort') {
    $message = @(
      "Aborted: $($expired.Count) candidates exceeds the -MaxDeletions ceiling of $MaxDeletions."
      'Nothing was deleted.'
      'A count this high usually means the identification rule no longer matches what the tenant issues.'
      "Check the candidates with -WhatIf, then re-run with -MaxDeletions $($expired.Count) if they are correct."
    ) -join ' '

    Disconnect-MgGraph | Out-Null
    throw $message
  }

  # TruncateOldest. Oldest first, because those are the ones whose 24 hours
  # expired longest ago and the ones a visitor was promised were already gone.
  $overflow = $expired.Count - $MaxDeletions
  Write-Warning "$($expired.Count) candidates exceeds the ceiling of $MaxDeletions. Taking the $MaxDeletions oldest; $overflow left for the next run."
  $expired = @($expired | Sort-Object CreatedDateTime | Select-Object -First $MaxDeletions)
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
  $target = "$(Get-PrincipalLabel $user) (age ${age}h)"

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
if ($overflow -gt 0) { Write-Host "Left for the next run        : $overflow" }

Disconnect-MgGraph | Out-Null

# Three things must fail the run rather than exit 0, because all three end with the
# site's claim being false while the log reads green:
#
#   a purge that did not complete leaves restorable PII behind a page that says the
#   account is gone; a soft-delete failure leaves a live expired account; and a
#   truncated run leaves expired accounts the visitor was told were already deleted.
#
# A silent green run is how the first real purge failure reached a handoff that
# called it "unconfirmed".
$problems = @()
if ($failed -gt 0) { $problems += "$failed soft-delete failure(s)" }
if ($unpurged -gt 0) { $problems += "$unpurged soft-deleted but not purged (still restorable)" }
if ($overflow -gt 0) { $problems += "$overflow expired account(s) left undeleted by the -MaxDeletions ceiling of $MaxDeletions" }

if ($problems.Count -gt 0) {
  throw "Completed with problems: $($problems -join ', '). See the warnings above."
}
