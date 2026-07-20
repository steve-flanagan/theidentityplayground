# 002. Azure DNS over Cloudflare for the domain

**Status:** decided 16 July 2026 (spec commit `cd4865a`). **Built and verified live.** The
zone is delegated, the apex is bound to the Static Web App by an alias record, and the site
serves at https://theidentityplayground.com.

Every factual claim below is marked **[M]** if it was read in current project documentation
(source given) or **[A]** if it is assumed and still needs testing. This one is in
production, so nearly all of it is **[M]** and confirmed against live resolvers rather than
against docs.

Sources are cited by section rather than line number, because the spec moves.

---

## Context

`theidentityplayground.com` is registered at GoDaddy, three years, bought July 2026. **[M]**
(spec § 2 → Domain & DNS)

The domain is a hard dependency, not cosmetics. Passkey registration in External ID
external tenants requires a verified custom URL domain, so Module 3 does not exist without
one. **[M]** (spec § 2 → Domain & DNS; § 7 → Settled since the first draft)

**What forced the choice:** pointing the apex at Static Web Apps requires an ALIAS/ANAME
record or CNAME flattening, and GoDaddy's DNS supports none of them. **[M]** (spec § 2 →
Domain & DNS; § 7) Without one of those the apex is stuck on a single-IP `A` record, which
loses SWA's global distribution, or on a `www` redirect. **[M]**
([tenant-setup/README.md](../tenant-setup/README.md) → Apex domain → Static Web App)

So DNS had to leave GoDaddy. The only open question was where it went.

## Decision

**Registration stays at GoDaddy. Nameservers point at Azure DNS.** **[M]** (spec § 2 →
Domain & DNS; [tenant-setup/README.md](../tenant-setup/README.md) → DNS delegation)

Azure DNS handles apex to SWA via alias records and is Microsoft's documented answer to
exactly this registrar gap. **[M]** (spec § 2 → Domain & DNS) Confirmed in the build: Azure
DNS accepts a Static Web App as an alias target, which is the whole reason DNS left
GoDaddy. **[M]** ([tenant-setup/README.md](../tenant-setup/README.md))

Delegation verified on public resolvers: `ns1-02.azure-dns.com`, `ns2-02.azure-dns.net`,
`ns3-02.azure-dns.org`, `ns4-02.azure-dns.info`. **[M]**
([tenant-setup/README.md](../tenant-setup/README.md))

## Rejected alternatives

**Cloudflare.** Free, and it would also work. **[M]** (spec § 2 → Domain & DNS) It lost on
two things, neither of them technical:

1. Azure DNS keeps the project to one vendor and one budget.
2. A DNS zone is Bicep-templatable, which makes the `infra/` stretch goal real portfolio
   material instead of a checkbox in a web console. **[M]** (spec § 2 → Domain & DNS)

Cost was not the tiebreaker, and ran the wrong way. Azure DNS is about $0.50 a month
against Cloudflare's $0. **[M]** (spec § 2 → Hosting)

**Leaving DNS at GoDaddy.** Ruled out by the apex constraint above, not by preference.

**Moving the registration as well.** Never proposed. The record states that registration
stays at GoDaddy and gives no reason for keeping it there, so none is offered here.

## Consequences

**Two records at the apex, and one of them is not an IP.** A TXT record carrying the
validation token from `az staticwebapp hostname set`, and an alias `A` record pointing at
the Static Web App's **resource ID**. **[M]**
([tenant-setup/README.md](../tenant-setup/README.md) → Apex domain → Static Web App, which
carries the working commands)

**Two traps found during the build, both recorded so they are not rediscovered.** **[M]**
(same source)

- Run the `az` commands from PowerShell, not Git Bash. MSYS path conversion rewrites the
  leading `/` of an Azure resource ID into a Windows path, and the call fails with a
  misleading `LinkedInvalidPropertyId`.
- The record-set field is `TXTRecords`, not `txtRecords`. JMESPath is case-sensitive, so
  the wrong case returns nothing and looks exactly like an empty record.

**A fixed line item that cannot run away.** About $0.50 a month, and the spec's runaway
analysis lists the DNS zone as one of the resources with no escalation path. **[M]**
(spec § 4, item 6)

**The domain is now locked for the life of the passkeys.** A passkey binds to a single
relying-party domain and Entra does not support related origins, so changing the domain
later invalidates every registered passkey. **[M]** (spec § 2 → Domain & DNS) The delegation
had to be done in Phase 0 rather than during Module 3 for this reason.

**Apex propagation can take up to 72 hours,** though in practice it was minutes. **[M]**
([tenant-setup/README.md](../tenant-setup/README.md))
