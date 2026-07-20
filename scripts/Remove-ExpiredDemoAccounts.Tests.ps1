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
  $global:purgedIds.Add($DirectoryObjectId)
}

# ── Synthetic users ───────────────────────────────────────────────────────────
# Every property the script reads must exist, or Set-StrictMode turns a skipped
# user into a terminating error and the test would be measuring the wrong thing.

function New-SyntheticUser {
  param(
    [string] $Upn,
    [double] $AgeHours = 100,
    [string[]] $SignInTypes = @('emailAddress'),
    [switch] $NoCreatedDate,
    [switch] $NoIdentities
  )

  $identities = if ($NoIdentities) { $null }
                else { @($SignInTypes | ForEach-Object { [pscustomobject]@{ SignInType = $_ } }) }

  [pscustomobject]@{
    Id                = $Upn
    DisplayName       = $Upn
    UserPrincipalName = $Upn
    CreatedDateTime   = if ($NoCreatedDate) { $null } else { (Get-Date).ToUniversalTime().AddHours(-$AgeHours) }
    Identities        = $identities
    UserType          = 'Member'
  }
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
  param([int] $Count)
  1..$Count | ForEach-Object { New-SyntheticUser -Upn "aged-$_@demo" }
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
    [hashtable] $Parameters = @{}
  )

  $global:tenantUsers = @($Users)
  $global:roleMembers = $Roles
  $global:deletedIds = [System.Collections.Generic.List[string]]::new()
  $global:purgedIds = [System.Collections.Generic.List[string]]::new()
  $global:connectArgs = $null

  # -Confirm:$false everywhere. These tests are about the other guards; the
  # ShouldProcess prompt would just hang an unattended run.
  $splat = @{ Confirm = $false } + $Parameters

  try {
    & $ScriptPath @splat *>&1 | Out-Null
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
