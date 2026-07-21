# The halt was a false alarm: az writes warnings (like "not active until content
# is published") to stderr, and $ErrorActionPreference='Stop' turned that into a
# fatal NativeCommandError even though az exited 0. Fix: drop the global Stop and
# gate on the real exit code. Safe to re-run from the top — every step is idempotent.
$ErrorActionPreference = 'Continue'

function Invoke-Az {
  # Run az; stop only on a genuine non-zero exit, not on a stderr warning.
  $out = az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit $LASTEXITCODE)" }
  return $out
}

$SUB      = '9a01608f-7bec-4772-a227-33f55291fa93'
$RG       = 'rg-theidentityplayground'
$LOCATION = 'eastus2'
$STORAGE  = 'stidplayground'
$FUNCAPP  = 'func-theidentityplayground'
$KV       = 'kv-theidplayground'
$CIAPP    = 'theidentityplayground-ci-deploy'
$GH_SUBJECT = 'repo:steve-flanagan@234824944/theidentityplayground@1302989710:ref:refs/heads/main'

$null = Invoke-Az account set --subscription $SUB
$TENANT = Invoke-Az account show --query tenantId -o tsv

# Storage + Function App already exist; both creates are no-ops now.
$null = Invoke-Az storage account create -n $STORAGE -g $RG -l $LOCATION `
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
$null = Invoke-Az functionapp create -n $FUNCAPP -g $RG `
  --storage-account $STORAGE --consumption-plan-location $LOCATION `
  --os-type Linux --runtime node --runtime-version 22 --functions-version 4 --disable-app-insights true

$null = Invoke-Az functionapp identity assign -n $FUNCAPP -g $RG
$MI = Invoke-Az functionapp identity show -n $FUNCAPP -g $RG --query principalId -o tsv

foreach ($o in @('https://theidentityplayground.com','https://www.theidentityplayground.com','http://localhost:5173')) {
  $null = Invoke-Az functionapp cors add -n $FUNCAPP -g $RG --allowed-origins $o
}

$null = Invoke-Az functionapp config appsettings set -n $FUNCAPP -g $RG --settings `
  "RATE_LIMIT_TABLE_ENDPOINT=https://$STORAGE.table.core.windows.net" "RATE_LIMIT_TABLE_NAME=RateLimit"
$SA_ID = Invoke-Az storage account show -n $STORAGE -g $RG --query id -o tsv
$null = Invoke-Az role assignment create --assignee-object-id $MI --assignee-principal-type ServicePrincipal `
  --role 'Storage Table Data Contributor' --scope $SA_ID

$null = Invoke-Az keyvault create -n $KV -g $RG -l $LOCATION --enable-rbac-authorization true
$KV_ID = Invoke-Az keyvault show -n $KV -g $RG --query id -o tsv
$null = Invoke-Az role assignment create --assignee-object-id $MI --assignee-principal-type ServicePrincipal `
  --role 'Key Vault Secrets User' --scope $KV_ID

# CI deploy identity. Reuse if a prior run made it — az ad app create does not
# dedupe by name, so guard against a duplicate registration.
$CI_APPID = az ad app list --display-name $CIAPP --query '[0].appId' -o tsv
if (-not $CI_APPID) { $CI_APPID = Invoke-Az ad app create --display-name $CIAPP --query appId -o tsv }
if (-not (az ad sp show --id $CI_APPID --query id -o tsv 2>$null)) { $null = Invoke-Az ad sp create --id $CI_APPID }

if (-not (az ad app federated-credential list --id $CI_APPID --query "[?name=='github-main'].name" -o tsv 2>$null)) {
  $ficPath = Join-Path $env:TEMP 'fic.json'
  @{ name='github-main'; issuer='https://token.actions.githubusercontent.com'; subject=$GH_SUBJECT; audiences=@('api://AzureADTokenExchange') } |
    ConvertTo-Json | Out-File -FilePath $ficPath -Encoding utf8
  $null = Invoke-Az ad app federated-credential create --id $CI_APPID --parameters "@$ficPath"
  Remove-Item $ficPath
}

$CI_SP   = Invoke-Az ad sp show --id $CI_APPID --query id -o tsv
$FUNC_ID = Invoke-Az functionapp show -n $FUNCAPP -g $RG --query id -o tsv
$null = Invoke-Az role assignment create --assignee-object-id $CI_SP --assignee-principal-type ServicePrincipal `
  --role 'Contributor' --scope $FUNC_ID

gh variable set AZURE_CLIENT_ID --body $CI_APPID
gh variable set AZURE_TENANT_ID --body $TENANT
gh variable set AZURE_SUBSCRIPTION_ID --body $SUB

Write-Host "`nDone. 'Not active until content is published' is expected — the CI deploy publishes and activates it."
Write-Host "Function App: https://$FUNCAPP.azurewebsites.net"