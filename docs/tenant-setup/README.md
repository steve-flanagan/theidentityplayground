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
| External ID tenant — tenant ID | _to record_ |
| Demo workforce tenant | **blocked** — paid P1 now required to create a workforce tenant; see the spec |
| Azure subscription (hosting) | existing pay-as-you-go |
| Resource group | _to record_ |
| DNS zone | `theidentityplayground.com` — delegated to Azure DNS, verified live |
| Licence state (P1 / P2 trial + expiry) | _none yet_ |

**DNS delegation — done.** GoDaddy remains the registrar; the zone is authoritative on
Azure. Confirmed on public resolvers:

```
ns1-02.azure-dns.com   ns2-02.azure-dns.net
ns3-02.azure-dns.org   ns4-02.azure-dns.info
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
