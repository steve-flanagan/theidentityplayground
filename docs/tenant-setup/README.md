# Tenant setup

> **Stub — Phase 0.** Write each page as the configuration is actually done, not from
> memory afterward.

Step-by-step Entra configuration, one page per module. Screenshots are fine and
encouraged — these double as the per-module blog posts in the distribution plan
(spec section 8).

Record here as they're created:

| Thing | Value |
|---|---|
| External ID tenant — org name | The Identity Playground |
| External ID tenant — initial domain | `theidentityplayground.onmicrosoft.com` |
| External ID tenant — tenant ID | `7e8da8a9-67bc-4d53-bfc7-fe3e13128382` |
| Demo workforce tenant — org name | The Identity Playground (workforce) |
| Demo workforce tenant — initial domain | `theidentityplaygroundgmail.onmicrosoft.com` |
| Demo workforce tenant — tenant ID | `9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4` |
| Demo workforce tenant — subscription | `c436a5b3-ecc8-4075-ace6-ff05cc5560c1` (trial) |
| Azure subscription (hosting) | existing pay-as-you-go |
| Resource group | `rg-theidentityplayground` |
| DNS zone | `theidentityplayground.com` — delegated to Azure DNS, verified live |
| Licence state (P1 / P2 trial + expiry) | _none yet_ |

**DNS delegation — done.** GoDaddy remains the registrar; the zone is authoritative on
Azure. Confirmed on public resolvers:

```
ns1-02.azure-dns.com   ns2-02.azure-dns.net
ns3-02.azure-dns.org   ns4-02.azure-dns.info
```

## Apex domain → Static Web App

Two records at the apex, both in the Azure DNS zone. **Azure DNS supports Static Web Apps
as an alias target** — confirmed working, which is the whole reason DNS left GoDaddy.
GoDaddy's DNS has no ALIAS/ANAME/flattening, so the apex would otherwise have been stuck
on a single-IP `A` record (losing SWA's global distribution) or a `www` redirect.

| Type | Name | Value |
|---|---|---|
| TXT | `@` | validation token from `az staticwebapp hostname set` |
| A (alias) | `@` | → the Static Web App **resource ID**, not an IP |

```powershell
# 1. Register the domain and get a validation token
az staticwebapp hostname set -n stapp-theidentityplayground -g rg-theidentityplayground `
  --hostname theidentityplayground.com --validation-method dns-txt-token

# 2. TXT record carrying that token at the apex
az network dns record-set txt add-record -g rg-theidentityplayground `
  -z theidentityplayground.com -n "@" -v "<token>"

# 3. Alias A record at the apex pointing at the SWA resource
$swaId = az staticwebapp show -n stapp-theidentityplayground -g rg-theidentityplayground --query id -o tsv
az network dns record-set a create -g rg-theidentityplayground `
  -z theidentityplayground.com -n "@" --target-resource $swaId
```

**Two traps worth knowing:**

- **Run these from PowerShell, not Git Bash.** Git Bash's MSYS path conversion rewrites the
  leading `/` of an Azure resource ID into `C:/Program Files/Git/...` and the call fails with
  a confusing `LinkedInvalidPropertyId`. Prefix with `MSYS_NO_PATHCONV=1` if you must use bash.
- **The record set field is `TXTRecords`, not `txtRecords`.** JMESPath is case-sensitive, so
  `--query 'txtRecords[].value'` silently returns nothing and looks exactly like an empty record.

Apex changes can take up to 72 hours to propagate, though in practice it was minutes.

## Verified endpoints (External ID tenant)

Read live from the tenant's OIDC discovery document rather than copied from docs:

```
MSAL authority:  https://theidentityplayground.ciamlogin.com/7e8da8a9-67bc-4d53-bfc7-fe3e13128382
issuer (iss):    https://7e8da8a9-67bc-4d53-bfc7-fe3e13128382.ciamlogin.com/7e8da8a9-.../v2.0
```

**The issuer host is not the authority host.** Endpoints live on the tenant-*name*
subdomain; the `iss` claim uses the tenant-*GUID* subdomain. Assume they match and your
token validation breaks. Worth annotating in Module 1.

To re-check after any tenant change:

```bash
curl -s https://theidentityplayground.ciamlogin.com/7e8da8a9-67bc-4d53-bfc7-fe3e13128382/v2.0/.well-known/openid-configuration | jq
```

**Never record secrets here.** App registration client IDs and tenant IDs are fine — they
are not secrets. Client secrets, certificates, and tokens go in Key Vault and nowhere
else.

## Pages to write

- `01-external-id-tenant.md` — tenant creation, subscription link, user flows
- `02-workforce-tenant.md` — tenant creation, hardening, demo accounts
- `03-app-registrations.md` — every app registration and why it exists
- `04-custom-domain.md` — Azure DNS zone, GoDaddy delegation, Entra custom URL domain
- `05-graph-permissions.md` — the permission inventory, with justification per scope
