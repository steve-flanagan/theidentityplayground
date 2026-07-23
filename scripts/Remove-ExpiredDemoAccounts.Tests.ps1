<#
.SYNOPSIS
    Guard tests for Remove-ExpiredDemoAccounts.ps1. No Pester, no network, no tenant.

.DESCRIPTION
    This script deletes users. The guards are the entire argument for letting a
    machine run it unattended, so they get exercised against synthetic users on
    every change, under the same Set-StrictMode -Version Latest the real script runs
    under.

    HOW IT WORKS, and the one non-obvious part. The Graph SDK exports its commands
    as FUNCTIONS in the global scope, not as cmdlets, so an ordinary script-scoped
    stub does not shadow them: the module's version wins and the test hits the real
    Graph. The stubs below are therefore defined in the global scope AFTER the
    modules are imported, which replaces the module's entries in the global function
    table. The script's own `#Requires -Modules` then finds the modules already
    loaded and does not re-import over the top of them.

    The tests invoke the actual script file rather than a copy of its logic. Testing
    a reimplementation of a guard proves nothing about the guard.

    Nothing here reaches the network. Every user is synthetic.

.PARAMETER ScriptPath
    Which file to test. Defaults to the sibling script. Point it at an older copy to
    confirm a test genuinely fails without the change it covers.

.EXAMPLE
    ./Remove-ExpiredDemoAccounts.Tests.ps1
    Exits 0 if every test passes, 1 if any fail.
#>

[CmdletBinding()]
param(
  [string] $ScriptPath = (Join-Path $PSScriptRoot 'Remove-ExpiredDemoAccounts.ps1')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ScriptPath)) { throw "Script under test not found: $ScriptPath" }

# ── Recorded state ────────────────────────────────────────────────────────────
# The stubs write here; the assertions read it. Reset before every invocation.
$global:tenantUsers = @()
$global:roleMembers = @{}
$global:deletedIds = [System.Collections.Generic.List[string]]::new()
$global:purgedIds = [System.Collections.Generic.List[string]]::new()
$global:connectArgs = $null

# Purge simulator state. purgeThrowCount is how many times the purge stub 404s for a
# given id before it succeeds; purgeThrowMessage is what it throws. Attempts are
# tracked per id so a multi-user run stays per-user. These let a test prove the retry.
$global:runOutput = ''
$global:purgeAttemptsById = @{}
$global:purgeThrowCount = 0
$global:purgeThrowMessage = "[Request_ResourceNotFound] : Resource does not exist or one of its queried reference-property objects are not present."

# ── Graph stubs ───────────────────────────────────────────────────────────────
# Import first, stub second. See the note in the header: these have to be global
# and they have to be defined after the import, or the SDK's own functions win.
Import-Module Microsoft.Graph.Authentication, `
  Microsoft.Graph.Users, `
  Microsoft.Graph.Identity.DirectoryManagement `
  -Global

# Each stub takes the parameters the script actually passes.
# ValueFromRemainingArguments absorbs anything else, so a new argument in the
# script surfaces as a failed assertion rather than a parameter-binding error.

function global:Connect-MgGraph {
  [CmdletBinding()]
  param(
    [string] $TenantId,
    [string[]] $Scopes,
    [System.Security.SecureString] $AccessToken,
    [switch] $NoWelcome,
    [Parameter(ValueFromRemainingArguments)] $Rest
  )
  $global:connectArgs = @{ TenantId = $TenantId; Scopes = $Scopes; AccessToken = $AccessToken }
}

function global:Get-MgContext {
  [CmdletBinding()]
  param()
  [pscustomobject]@{
    TenantId = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382'
    Account  = 'admin@example.onmicrosoft.com'
    ClientId = '2d0fb6bd-4e37-463c-9a9a-4b78bde66803'
  }
}

function global:Disconnect-MgGraph {
  [CmdletBinding()]
  param([Parameter(ValueFromRemainingArguments)] $Rest)
}

function global:Get-MgDirectoryRole {
  [CmdletBinding()]
  param([switch] $All, [Parameter(ValueFromRemainingArguments)] $Rest)
  foreach ($roleId in $global:roleMembers.Keys) { [pscustomobject]@{ Id = $roleId } }
}

function global:Get-MgDirectoryRoleMember {
  [CmdletBinding()]
  param([string] $DirectoryRoleId, [switch] $All, [Parameter(ValueFromRemainingArguments)] $Rest)
  foreach ($memberId in $global:roleMembers[$DirectoryRoleId]) { [pscustomobject]@{ Id = $memberId } }
}

function global:Get-MgUser {
  [CmdletBinding()]
  param([switch] $All, [string[]] $Property, [Parameter(ValueFromRemainingArguments)] $Rest)
  # Return the array itself, not a pipeline-unrolled copy, so .Count is stable.
  , $global:tenantUsers
}

function global:Remove-MgUser {
  [CmdletBinding()]
  param([string] $UserId, [Parameter(ValueFromRemainingArguments)] $Rest)
  $global:deletedIds.Add($UserId)
}

function global:Remove-MgDirectoryDeletedItem {
  [CmdletBinding()]
  param([string] $DirectoryObjectId, [Parameter(ValueFromRemainingArguments)] $Rest)

  if (-not $global:purgeAttemptsById.ContainsKey($DirectoryObjectId)) {
    $global:purgeAttemptsById[$DirectoryObjectId] = 0
  }
  $global:purgeAttemptsById[$DirectoryObjectId]++

  # 404 for the first purgeThrowCount attempts on this id, then succeed. A count
  # higher than the script's attempt budget models an object that never appears.
  if ($global:purgeAttemptsById[$DirectoryObjectId] -le $global:purgeThrowCount) {
    throw $global:purgeThrowMessage
  }
  $global:purgedIds.Add($DirectoryObjectId)
}

# ── Synthetic users ───────────────────────────────────────────────────────────
# Every property the script reads must exist, or Set-StrictMode turns a skipped
# user into a terminating error and the test would be measuring the wrong thing.

function New-SyntheticUser {
  param(
    [string] $Upn,
    # Defaults to the UPN so most assertions can read deletedIds as names. Pass a
    # distinct one where the difference between the two is the thing under test.
    [string] $Id,
    [double] $AgeHours = 100,
    [string[]] $SignInTypes = @('emailAddress'),
    [string] $UserType = 'Member',
    # $null is the documented creationType of an ordinary work or school account.
    [string] $CreationType = $null,
    [switch] $NoCreatedDate,
    [switch] $NoIdentities
  )

  $identities = if ($NoIdentities) { $null }
                else { @($SignInTypes | ForEach-Object { [pscustomobject]@{ SignInType = $_ } }) }

  [pscustomobject]@{
    Id                = if ($Id) { $Id } else { $Upn }
    DisplayName       = $Upn
    UserPrincipalName = $Upn
    CreatedDateTime   = if ($NoCreatedDate) { $null } else { (Get-Date).ToUniversalTime().AddHours(-$AgeHours) }
    Identities        = $identities
    UserType          = $UserType
    CreationType      = $CreationType
  }
}

function New-SyntheticGuest {
  <#
    What /guest produces: a B2B guest created by the B2X_1_B2B self-service sign-up
    user flow. Graph marks exactly these with creationType SelfServiceSignUp.
  #>
  param(
    [string] $Upn,
    [double] $AgeHours = 100,
    [string[]] $SignInTypes = @('federated')
  )
  New-SyntheticUser -Upn $Upn -AgeHours $AgeHours -SignInTypes $SignInTypes `
    -UserType 'Guest' -CreationType 'SelfServiceSignUp'
}

# The standard mixed population: one legitimate candidate per guard it must clear,
# and one user per guard that must stop it.
function Get-MixedPopulation {
  @(
    New-SyntheticUser -Upn 'aged-signup-1@demo'                                     # candidate
    New-SyntheticUser -Upn 'aged-signup-2@demo' -SignInTypes 'federated'            # candidate, Google
    New-SyntheticUser -Upn 'admin@demo' -AgeHours 999                               # role holder
    New-SyntheticUser -Upn 'no-identities@demo' -NoIdentities                       # unidentifiable
    New-SyntheticUser -Upn 'guest@demo' -SignInTypes 'userPrincipalName'            # not a signup
    New-SyntheticUser -Upn 'fresh@demo' -AgeHours 2                                 # inside the TTL
    New-SyntheticUser -Upn 'no-created-date@demo' -NoCreatedDate                     # cannot be aged
  )
}

function Get-AgedSignups {
  # AgeStep spreads the ages so oldest-first truncation has something to sort on.
  # aged-1 is the youngest, aged-$Count the oldest.
  param([int] $Count, [double] $AgeStep = 0)
  1..$Count | ForEach-Object {
    New-SyntheticUser -Upn "aged-$_@demo" -AgeHours (100 + ($_ - 1) * $AgeStep)
  }
}

function Get-AgedGuests {
  param([int] $Count, [double] $AgeStep = 0)
  1..$Count | ForEach-Object {
    New-SyntheticGuest -Upn "guest-$_@demo" -AgeHours (100 + ($_ - 1) * $AgeStep)
  }
}

# The workforce tenant as it actually stands: the admin, the demo member, and
# whatever /guest has created. One user per rule that must stop the sweep.
function Get-WorkforcePopulation {
  @(
    New-SyntheticGuest -Upn 'guest-google@demo'                                     # candidate
    New-SyntheticGuest -Upn 'guest-msa@demo' -SignInTypes 'federated'               # candidate
    New-SyntheticUser -Upn 'admin@demo' -AgeHours 999                               # role holder
    New-SyntheticUser -Upn 'Member@theidentityplayground.com' -AgeHours 999 `
      -SignInTypes 'userPrincipalName'                                              # the demo employee
    New-SyntheticUser -Upn 'invited@demo' -UserType 'Guest' -CreationType 'Invitation'  # invited, not ours
    New-SyntheticUser -Upn 'email-verified@demo' -CreationType 'EmailVerified'      # internal self-signup
    New-SyntheticGuest -Upn 'fresh-guest@demo' -AgeHours 2                          # inside the TTL
  )
}

# ── Harness ───────────────────────────────────────────────────────────────────

$script:passed = 0
$script:failed = 0

function Invoke-Cleanup {
  <#
    Resets recorded state, sets the tenant population, and runs the script under
    test. Returns the terminating error if one was thrown, otherwise $null, so a
    test can assert on the abort without the harness dying.
  #>
  param(
    [object[]] $Users,
    [hashtable] $Roles = @{},
    [hashtable] $Parameters = @{},
    [int] $PurgeThrowCount = 0,
    [string] $PurgeThrowMessage = "[Request_ResourceNotFound] : Resource does not exist or one of its queried reference-property objects are not present."
  )

  $global:tenantUsers = @($Users)
  $global:roleMembers = $Roles
  $global:deletedIds = [System.Collections.Generic.List[string]]::new()
  $global:purgedIds = [System.Collections.Generic.List[string]]::new()
  $global:connectArgs = $null
  $global:purgeAttemptsById = @{}
  $global:purgeThrowCount = $PurgeThrowCount
  $global:purgeThrowMessage = $PurgeThrowMessage

  $global:runOutput = ''

  # -Confirm:$false everywhere. These tests are about the other guards; the
  # ShouldProcess prompt would just hang an unattended run.
  $splat = @{ Confirm = $false } + $Parameters

  try {
    # Every stream captured, not discarded: what a run PRINTS is itself under test
    # now that the unattended run's log is a public artifact.
    $global:runOutput = (& $ScriptPath @splat *>&1 | Out-String)
    return $null
  }
  catch {
    return $_
  }
}

function Test-Case {
  param([string] $Name, [scriptblock] $Body)
  try {
    & $Body
    $script:passed++
    Write-Host "  PASS  $Name" -ForegroundColor Green
  }
  catch {
    $script:failed++
    Write-Host "  FAIL  $Name" -ForegroundColor Red
    Write-Host "        $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Assert-Equal {
  param($Expected, $Actual, [string] $Because)
  if ($Expected -ne $Actual) { throw "$Because : expected '$Expected', got '$Actual'" }
}

function Assert-Collection {
  param([string[]] $Expected, [string[]] $Actual, [string] $Because)
  $e = ($Expected | Sort-Object) -join ', '
  $a = ($Actual | Sort-Object) -join ', '
  if ($e -ne $a) { throw "$Because : expected [$e], got [$a]" }
}

function Assert-CeilingAbort {
  <#
    Asserts the run stopped because of the ceiling specifically, and took nothing
    with it. Matching the script's own message matters: a build with no
    -MaxDeletions parameter also throws (on parameter binding) and also deletes
    nothing, so "it threw and deleted nothing" would pass against a script that has
    no ceiling at all.
  #>
  param($Error)

  if ($null -eq $Error) { throw 'expected the run to abort, it completed' }
  if ($Error.Exception.Message -notmatch 'exceeds the -MaxDeletions ceiling') {
    throw "expected the script's own ceiling abort, got: $($Error.Exception.Message)"
  }
  Assert-Equal 0 $global:deletedIds.Count 'an abort must delete nothing'
  Assert-Equal 0 $global:purgedIds.Count 'an abort must purge nothing'
}

# ── Tests ─────────────────────────────────────────────────────────────────────

Write-Host "`nTesting $ScriptPath`n"

Write-Host 'The four guards'

Test-Case 'Only aged sign-up-flow accounts are deleted' {
  $roles = @{ 'role-ga' = @('admin@demo') }
  $err = Invoke-Cleanup -Users (Get-MixedPopulation) -Roles $roles
  Assert-Equal $null $err 'should not have thrown'
  Assert-Collection @('aged-signup-1@demo', 'aged-signup-2@demo') $global:deletedIds `
    'only the aged sign-up accounts should be deleted'
}

Test-Case 'A role holder is never deleted, whatever its age' {
  $roles = @{ 'role-ga' = @('admin@demo') }
  $users = @(New-SyntheticUser -Upn 'admin@demo' -AgeHours 999)
  $err = Invoke-Cleanup -Users $users -Roles $roles
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'a role holder must survive'
}

Test-Case 'A user with no identities is skipped' {
  $err = Invoke-Cleanup -Users @(New-SyntheticUser -Upn 'no-identities@demo' -NoIdentities)
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'unidentifiable users must be skipped'
}

Test-Case 'A guest whose signInType is userPrincipalName is skipped' {
  $err = Invoke-Cleanup -Users @(New-SyntheticUser -Upn 'guest@demo' -SignInTypes 'userPrincipalName')
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'guests did not come through the sign-up flow'
}

Test-Case 'An explicitly protected UPN is skipped' {
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 3) `
    -Parameters @{ ProtectedUserPrincipalName = @('aged-2@demo') }
  Assert-Equal $null $err 'should not have thrown'
  Assert-Collection @('aged-1@demo', 'aged-3@demo') $global:deletedIds `
    'the protected UPN must survive'
}

Test-Case 'An account inside the TTL is not touched' {
  $err = Invoke-Cleanup -Users @(New-SyntheticUser -Upn 'fresh@demo' -AgeHours 2)
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'a 2-hour-old account is not expired'
}

Test-Case 'MaxAgeHours moves the cutoff' {
  $users = @(New-SyntheticUser -Upn 'aged-1@demo' -AgeHours 50)
  $err = Invoke-Cleanup -Users $users -Parameters @{ MaxAgeHours = 72 }
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count '50h is inside a 72h TTL'
}

Write-Host "`nPurge"

Test-Case 'Deleted accounts are purged by default' {
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 2)
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 2 $global:purgedIds.Count 'soft delete leaves 30 days of restorable PII'
}

Test-Case 'SkipPurge leaves the restore window open' {
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 2) -Parameters @{ SkipPurge = $true }
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 2 $global:deletedIds.Count 'still soft-deletes'
  Assert-Equal 0 $global:purgedIds.Count 'but does not purge'
}

Write-Host "`nPurge under replication lag"

Test-Case 'A transient 404 on purge is retried, and the account is then purged' {
  # The bug this fixes: the purge can outrun the directory replicating the soft
  # delete into deletedItems and 404 on an object that does exist. One transient
  # 404, then it succeeds on the retry.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 1) `
    -PurgeThrowCount 1 -Parameters @{ PurgeRetryDelaySeconds = 0 }
  Assert-Equal $null $err 'a purge that succeeds on retry is not a failed run'
  Assert-Equal 1 $global:purgedIds.Count 'the account should end up purged'
  Assert-Equal 2 $global:purgeAttemptsById['aged-1@demo'] 'it should take exactly one retry'
}

Test-Case 'A purge that keeps 404ing gives up, keeps the soft delete, and fails the run' {
  # Bounded: it must not retry forever, and when it gives up the account is
  # soft-deleted but not purged. That is restorable PII behind a page that says
  # otherwise, so the run must fail loudly rather than exit 0.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 1) `
    -PurgeThrowCount 99 -Parameters @{ PurgeRetryDelaySeconds = 0 }
  if ($null -eq $err) { throw 'a run that left an account unpurged must not exit clean' }
  if ($err.Exception.Message -notmatch 'not purged') {
    throw "expected an unpurged-account failure, got: $($err.Exception.Message)"
  }
  Assert-Collection @('aged-1@demo') $global:deletedIds 'the soft delete still happened'
  Assert-Equal 0 $global:purgedIds.Count 'nothing was purged'
  if ($global:purgeAttemptsById['aged-1@demo'] -le 1) {
    throw 'it should have retried, not given up after the first 404'
  }
}

Test-Case 'A purge error that is not a 404 is not retried' {
  # The retry is scoped to the replication-lag 404. A different Graph error is a
  # real problem and should surface on the first attempt, not after six.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 1) `
    -PurgeThrowCount 99 `
    -PurgeThrowMessage '[Authorization_RequestDenied] : Insufficient privileges to complete the operation.' `
    -Parameters @{ PurgeRetryDelaySeconds = 0 }
  if ($null -eq $err) { throw 'an unpurged account must fail the run' }
  Assert-Equal 1 $global:purgeAttemptsById['aged-1@demo'] 'a non-404 error must not be retried'
  Assert-Equal 0 $global:purgedIds.Count 'nothing was purged'
}

Write-Host "`nWhatIf"

Test-Case 'WhatIf deletes nothing' {
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 3) -Parameters @{ WhatIf = $true }
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'WhatIf must not delete'
  Assert-Equal 0 $global:purgedIds.Count 'WhatIf must not purge'
}

Write-Host "`nThe -MaxDeletions ceiling"

Test-Case 'Exceeding the ceiling aborts with ZERO deletions' {
  # The headline test. A ceiling that deleted up to the limit and stopped would
  # pass a naive "did it respect the cap" check while quietly emptying the tenant
  # over successive runs.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25) -Parameters @{ MaxDeletions = 5 }
  Assert-CeilingAbort $err
}

Test-Case 'The ceiling does not truncate to the limit' {
  # Explicitly the anti-assertion: 5 deletions here would mean a truncating cap.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25) -Parameters @{ MaxDeletions = 5 }
  if ($global:deletedIds.Count -eq 5) { throw 'ceiling truncated instead of aborting' }
  Assert-CeilingAbort $err
}

Test-Case 'Exactly at the ceiling proceeds' {
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 5) -Parameters @{ MaxDeletions = 5 }
  Assert-Equal $null $err 'the ceiling is exceeded only above it'
  Assert-Equal 5 $global:deletedIds.Count 'all five should go'
}

Test-Case 'One over the ceiling aborts' {
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 6) -Parameters @{ MaxDeletions = 5 }
  Assert-CeilingAbort $err
}

Test-Case 'The ceiling counts candidates, not tenant size' {
  # 40 users, 3 of them candidates. A ceiling that counted users would abort here
  # and the cleanup would never run.
  $users = @(Get-AgedSignups -Count 3) + @(1..37 | ForEach-Object {
      New-SyntheticUser -Upn "guest-$_@demo" -SignInTypes 'userPrincipalName'
    })
  $err = Invoke-Cleanup -Users $users -Parameters @{ MaxDeletions = 10 }
  Assert-Equal $null $err 'three candidates is under a ceiling of ten'
  Assert-Equal 3 $global:deletedIds.Count 'only the three candidates go'
}

Test-Case 'The ceiling fires under WhatIf too' {
  # A dry run should report what the real run would do, and the real run stops.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25) `
    -Parameters @{ MaxDeletions = 5; WhatIf = $true }
  Assert-CeilingAbort $err
}

Test-Case 'The default ceiling is 10' {
  # No -MaxDeletions passed, so this is the only ceiling test that exercises the
  # default. It is also the one that fails loudest against a script with no
  # ceiling: 11 candidates get deleted and nothing throws.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 11)
  Assert-CeilingAbort $err

  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 10)
  Assert-Equal $null $err '10 candidates should be allowed by the default ceiling'
  Assert-Equal 10 $global:deletedIds.Count 'all ten should go'
}

Write-Host "`n-Directory Workforce: the /guest sweep"

$workforce = @{ Directory = 'Workforce' }

Test-Case 'Only self-service B2B guests are deleted' {
  # The headline. Everything else in that tenant -- the admin, the demo employee,
  # an invited guest, an email-verified internal signup -- has to survive.
  $roles = @{ 'role-ga' = @('admin@demo') }
  $err = Invoke-Cleanup -Users (Get-WorkforcePopulation) -Roles $roles -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  Assert-Collection @('guest-google@demo', 'guest-msa@demo') $global:deletedIds `
    'only the aged self-service guests should be deleted'
}

Test-Case 'An INVITED B2B guest is never a candidate' {
  # creationType Invitation. A guest Steve invited by hand is not a demo account,
  # and this is the difference the whole rule turns on.
  $users = @(New-SyntheticUser -Upn 'invited@demo' -UserType 'Guest' -CreationType 'Invitation' -AgeHours 999)
  $err = Invoke-Cleanup -Users $users -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'an invited guest must survive'
}

Test-Case 'An ordinary employee is never a candidate' {
  # creationType null, userType Member. Member@theidentityplayground.com is this.
  $users = @(New-SyntheticUser -Upn 'Member@theidentityplayground.com' -AgeHours 999 `
      -SignInTypes 'userPrincipalName')
  $err = Invoke-Cleanup -Users $users -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'the demo member must survive'
}

Test-Case 'A self-service guest promoted to Member is skipped' {
  # Both properties have to agree. Flipping userType is a documented, one-click
  # portal action, so it is a realistic way for one half of the rule to go stale.
  $users = @(New-SyntheticUser -Upn 'promoted@demo' -UserType 'Member' `
      -CreationType 'SelfServiceSignUp' -AgeHours 999)
  $err = Invoke-Cleanup -Users $users -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'userType Member is not a guest object'
}

Test-Case 'In Workforce mode signInType is irrelevant' {
  # The workforce rule names the mechanism, not the credential. A guest with no
  # identities at all is still a candidate, which is the point: it does not
  # inherit the External ID sweep''s unverified signInType assumption.
  $users = @(New-SyntheticUser -Upn 'guest-no-identities@demo' -UserType 'Guest' `
      -CreationType 'SelfServiceSignUp' -NoIdentities -AgeHours 999)
  $err = Invoke-Cleanup -Users $users -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  Assert-Collection @('guest-no-identities@demo') $global:deletedIds `
    'creationType alone identifies it'
}

Test-Case 'The two rules do not leak into each other' {
  # A self-service guest under the External ID rule, and an emailAddress signup
  # under the Workforce rule. Each must be invisible to the other mode, or one
  # tenant''s assumption silently becomes the other''s.
  $guest = @(New-SyntheticUser -Upn 'guest@demo' -UserType 'Guest' `
      -CreationType 'SelfServiceSignUp' -SignInTypes 'userPrincipalName' -AgeHours 999)
  $err = Invoke-Cleanup -Users $guest -Parameters @{ Directory = 'ExternalId' }
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'ExternalId mode must not read creationType'

  $signup = @(New-SyntheticUser -Upn 'signup@demo' -SignInTypes 'emailAddress' -AgeHours 999)
  $err = Invoke-Cleanup -Users $signup -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 0 $global:deletedIds.Count 'Workforce mode must not read signInType'
}

Test-Case 'The default directory is ExternalId' {
  # No -Directory passed. A default that flipped would point the External ID
  # schedule at the wrong rule and silently stop deleting customers.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 2)
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 2 $global:deletedIds.Count 'the signInType rule should still be the default'
}

Test-Case 'The interactive tenant follows -Directory' {
  $null = Invoke-Cleanup -Users @() -Parameters $workforce
  Assert-Equal '9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4' $global:connectArgs.TenantId `
    'Workforce should default to the workforce tenant'

  $null = Invoke-Cleanup -Users @()
  Assert-Equal '7e8da8a9-67bc-4d53-bfc7-fe3e13128382' $global:connectArgs.TenantId `
    'ExternalId should default to the External ID tenant'
}

Test-Case 'An explicit -TenantId still wins' {
  $null = Invoke-Cleanup -Users @() -Parameters @{ Directory = 'Workforce'; TenantId = 'other-tenant' }
  Assert-Equal 'other-tenant' $global:connectArgs.TenantId 'an explicit tenant overrides the default'
}

Write-Host "`n-OnCeilingExceeded TruncateOldest"

Test-Case 'Truncate deletes exactly MaxDeletions, and the OLDEST ones' {
  # aged-25 is the oldest (Get-AgedSignups ages ascending). A spam wave must not
  # stop the sweep, and the accounts whose 24 hours expired longest ago go first.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25 -AgeStep 1) `
    -Parameters @{ MaxDeletions = 3; OnCeilingExceeded = 'TruncateOldest' }
  if ($null -eq $err) { throw 'a truncated run must not exit clean' }
  Assert-Collection @('aged-25@demo', 'aged-24@demo', 'aged-23@demo') $global:deletedIds `
    'the three oldest should go'
}

Test-Case 'Truncate still fails the run, naming what is left' {
  # The half-works-silently failure this whole design exists to avoid. Deleting
  # some and exiting 0 would read as a clean pass with expired accounts still live.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25 -AgeStep 1) `
    -Parameters @{ MaxDeletions = 3; OnCeilingExceeded = 'TruncateOldest' }
  if ($null -eq $err) { throw 'a truncated run must not exit clean' }
  if ($err.Exception.Message -notmatch '22 expired account') {
    throw "expected the message to name the 22 left behind, got: $($err.Exception.Message)"
  }
}

Test-Case 'Truncate under the ceiling behaves exactly like a normal run' {
  $err = Invoke-Cleanup -Users (Get-AgedGuests -Count 4 -AgeStep 1) `
    -Parameters @{ Directory = 'Workforce'; MaxDeletions = 10; OnCeilingExceeded = 'TruncateOldest' }
  Assert-Equal $null $err 'nothing was truncated, so nothing should throw'
  Assert-Equal 4 $global:deletedIds.Count 'all four go'
}

Test-Case 'Truncate deletes nothing under WhatIf, and still fails as a truncation' {
  # A dry run reports what the real run would do, and what the real run would do
  # is delete a slice and fail. Asserting on WHICH failure matters: an abort also
  # throws and also deletes nothing, so "it threw" alone would pass against a
  # build that has no truncation at all.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25 -AgeStep 1) `
    -Parameters @{ MaxDeletions = 3; OnCeilingExceeded = 'TruncateOldest'; WhatIf = $true }
  if ($null -eq $err) { throw 'the ceiling report must survive WhatIf' }
  if ($err.Exception.Message -notmatch 'left undeleted by the -MaxDeletions ceiling') {
    throw "expected the truncation failure, got: $($err.Exception.Message)"
  }
  Assert-Equal 0 $global:deletedIds.Count 'WhatIf must not delete'
}

Test-Case 'Abort is still the default when the ceiling is hit' {
  # No -OnCeilingExceeded passed. The External ID sweep must not quietly acquire
  # truncation, which for that tenant would be the wrong response entirely.
  $err = Invoke-Cleanup -Users (Get-AgedSignups -Count 25) -Parameters @{ MaxDeletions = 5 }
  Assert-CeilingAbort $err
}

Write-Host "`nWhat an unattended run prints"

# A guest whose UPN is a real visitor's address and whose object id is not, so
# "did it print the name" and "did it print the id" are different questions.
function Get-NamedGuest {
  New-SyntheticUser -Upn 'visitor_gmail.com#EXT#@theidentityplaygroundgmail.onmicrosoft.com' `
    -Id 'aaaaaaaa-1111-2222-3333-444444444444' `
    -UserType 'Guest' -CreationType 'SelfServiceSignUp' -SignInTypes 'federated'
}

Test-Case 'App-only output carries no principal names' {
  # The UPN of a demo account is a visitor's email address and the scheduled run's
  # log is public. Deleted accounts' UPNs are named in decision 003 as something
  # that must never be in run output.
  $token = ConvertTo-SecureString 'synthetic-not-a-real-token' -AsPlainText -Force
  $err = Invoke-Cleanup -Users @(Get-NamedGuest) `
    -Parameters @{ Directory = 'Workforce'; AccessToken = $token }
  Assert-Equal $null $err 'should not have thrown'
  Assert-Equal 1 $global:deletedIds.Count 'it still deletes them'
  if ($global:runOutput -match 'visitor_gmail\.com') {
    throw "an app-only run printed a principal name: $global:runOutput"
  }
  if ($global:runOutput -notmatch 'aaaaaaaa-1111-2222-3333-444444444444') {
    throw 'the object id should still be there, or a failed run cannot be traced'
  }
}

Test-Case 'An interactive run still names the accounts' {
  # An admin at a console is deciding whether to delete these specific people.
  $err = Invoke-Cleanup -Users @(Get-NamedGuest) -Parameters $workforce
  Assert-Equal $null $err 'should not have thrown'
  if ($global:runOutput -notmatch 'visitor_gmail\.com') {
    throw 'an interactive run should print the UPN'
  }
}

Test-Case 'The skip breakdown counts, and never names' {
  # A zero-candidate run and a run whose rule matches nothing print the same zero.
  # The breakdown is what tells them apart, and it has to do that without
  # publishing who was skipped.
  $token = ConvertTo-SecureString 'synthetic-not-a-real-token' -AsPlainText -Force
  $users = @(
    New-SyntheticUser -Upn 'employee@demo' -AgeHours 999 -SignInTypes 'userPrincipalName'
    New-SyntheticUser -Upn 'invited@demo' -UserType 'Guest' -CreationType 'Invitation' -AgeHours 999
    New-SyntheticGuest -Upn 'fresh@demo' -AgeHours 2
  )
  $err = Invoke-Cleanup -Users $users -Parameters @{ Directory = 'Workforce'; AccessToken = $token }
  Assert-Equal $null $err 'should not have thrown'
  if ($global:runOutput -notmatch 'not a self-service signup:\s*2') {
    throw "expected 2 unidentified, got: $global:runOutput"
  }
  if ($global:runOutput -notmatch 'inside the TTL\s*:\s*1') {
    throw "expected 1 inside the TTL, got: $global:runOutput"
  }
  if ($global:runOutput -match 'employee@demo') {
    throw 'the breakdown must not name who it skipped'
  }
}

Write-Host "`nAuth paths"

Test-Case 'No AccessToken means interactive delegated auth' {
  $null = Invoke-Cleanup -Users @()
  if ($null -ne $global:connectArgs.AccessToken) { throw 'should not pass a token' }
  Assert-Equal '7e8da8a9-67bc-4d53-bfc7-fe3e13128382' $global:connectArgs.TenantId 'tenant should be passed'
  if ($global:connectArgs.Scopes -notcontains 'User.ReadWrite.All') { throw 'delegated scopes expected' }
}

Test-Case 'An AccessToken switches to app-only, with no TenantId or Scopes' {
  # Connect-MgGraph's AccessToken parameter set does not accept -TenantId or
  # -Scopes. Passing them alongside a token is a binding error at runtime, in the
  # scheduled job, where nobody is watching.
  $token = ConvertTo-SecureString 'synthetic-not-a-real-token' -AsPlainText -Force
  $null = Invoke-Cleanup -Users @() -Parameters @{ AccessToken = $token }
  if ($null -eq $global:connectArgs.AccessToken) { throw 'the token should be passed through' }
  if ($global:connectArgs.TenantId) { throw '-TenantId must not be passed with a token' }
  if ($global:connectArgs.Scopes) { throw '-Scopes must not be passed with a token' }
}

# ── Result ────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host "Passed : $script:passed"
Write-Host "Failed : $script:failed"

if ($script:failed -gt 0) { exit 1 }
exit 0
