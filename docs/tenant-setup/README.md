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
| Demo workforce tenant | **blocked** — paid P1 now required to create a workforce tenant; see the spec |
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
