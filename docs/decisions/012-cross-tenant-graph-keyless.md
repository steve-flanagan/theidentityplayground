# 012. Reach Graph in a foreign tenant, keyless, with a multitenant app and a user-assigned identity

**Status:** decided and **proven in production** 28 July 2026. Supersedes the pessimistic half
of [003](003-cross-tenant-graph.md).

Every factual claim is marked **[M]** if it was read in current documentation (source and date
given), **[O]** if it was observed running, or **[A]** if it is assumed.

---

## Context

Two unbuilt modules need Microsoft Graph **at request time** in a tenant the backend does not
live in. The Admin's View reads `auditLogs/signIns` in the External ID tenant; Live SCIM writes
users into the workforce tenant. Neither can wait on a schedule.

**The existing keyless pattern does not extend to them.** Both cleanup sweeps reach Graph from
GitHub Actions: GitHub mints an OIDC token, a federated credential on an app registration
inside the foreign tenant trusts a repo ref, and no secret is stored. That works because a
sweep is a cron job. GitHub's scheduled-workflow floor is five minutes and delivery is
best-effort — a 2.5-hour lateness was observed on 23 July **[O]**. A visitor's click cannot
wait five minutes, let alone two hours.

Request-time work lives in the Function App (`func-theidentityplayground`), whose identity is a
principal in **AlinaSF**. Both demo tenants are separate directories. So the question is how a
managed identity in one tenant calls Graph in another.

**Microsoft's rule, read directly, is the thing that makes this look impossible:**

> *"Both the Microsoft Entra app and managed identity must belong to the same tenant."*

**[M]** ([workload-identity-federation-config-app-trust-managed-identity](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity),
ms.date 2025-06-06, updated 2026-06-15.)

[003](003-cross-tenant-graph.md) read that and concluded a multitenant route was *"untested and
unlikely"*, on the reasoning that external tenants have a reduced consent and gallery surface.
**That conclusion was wrong, and this record exists because nobody had tested it.**

**The same page states the supported way across:**

> *"If you need to access resources in another tenant, your app registration must be a
> multitenant application and provisioned into the other tenant."* … *"Accessing resources in
> another tenant is supported."*

**[M]**, same page and date.

**One constraint on that page had been missed entirely:**

> *"You can only use User-Assigned Managed Identities as a credential."*

**[M]**, same page. The Function App had only a **system-assigned** identity, which cannot be
the subject of a federated credential.

## Decision

**One multitenant app registration in the home tenant, federated to a user-assigned managed
identity, with its service principal consented into each foreign tenant.**

```
user-assigned MI  id-idp-graph  (AlinaSF, client 0e33961f-…6791, principal f28d8ac7-…cb9d)
  -> token for api://AzureADTokenExchange
  -> presented as a client assertion for app reg idp-graph-reader (e4cd67a8-…5ab8, multitenant)
  -> exchanged at the FOREIGN tenant's token endpoint
  -> app-only Graph token, scoped to that tenant
```

No secret and no certificate at any hop. The federated credential trusts the managed identity's
principal id, and that trust is the entire credential.

Implemented in [`api/src/lib/graphToken.ts`](../../api/src/lib/graphToken.ts).

## What was actually observed

**Admin consent succeeded in BOTH demo tenants, 27 July 2026 [O].** External ID presented the
requested Graph permissions and accepted, which is precisely the outcome 003 predicted would
fail. Proof is the service principal object rather than the consent screen: SP
`9f97eaed-…f950` exists in the External ID tenant carrying
`AppOwnerOrganizationId = 10f5e179-…b465`, i.e. it is the foreign app. The workforce tenant
also required an explicit consent step rather than provisioning silently.

**The exchange was proven end to end on 28 July 2026 [O]**, by `/api/tenant-probe` running in
the deployed Function App:

```
external   tokenAcquired: true  graphStatus: 200  rows: 1  newest: 2026-07-27T22:03:22Z
workforce  tokenAcquired: true  graphStatus: 200  rows: 1  newest: 2026-07-27T15:55:41Z
```

A consent screen is not a token, and a configured chain is not an observed one. This is the
observation.

**It settled a second open question in the same call [O]:** an **app-only** read of
`auditLogs/signIns` returns `200` in the External ID tenant. The premium licence gate does not
fire, even though external tenants report their licence as **Free** — a known Microsoft
behaviour that a premium check would plausibly have tripped over. A delegated read as Global
Admin had already worked on 27 July; app-only was the genuinely untested path, because
production runs app-only. **The Admin's View is not licence-blocked.**

## Consequences

**The Key Vault certificate fallback is dead. Do not build it.** 003's fallback was an app
registration inside each foreign tenant with a certificate in `kv-theidplayground`, read at
runtime by the managed identity. It definitely works and it reintroduces exactly the stored
credential this project exists to avoid. It is now unnecessary in both tenants.

**The Function App carries two managed identities, and that is a live footgun.**
`api/src/lib/rateLimit.ts` constructs `new DefaultAzureCredential()` with no client id. App
Service hands out the **system-assigned** identity when none is specified, so the storage and
Key Vault paths were unaffected — **verified by curling `/api/ping` for `200`s after the
user-assigned identity was attached [O]**, not assumed from the documentation. But any new code
that wants the user-assigned identity **must pass its client id explicitly**. Ask without one
and you silently get the wrong identity, and the assertion is then rejected for a reason whose
error text never mentions identities.

**SCIM's hosting objection weakens considerably.** With request-time Graph available from the
Function App, the SCIM work has no remaining need for a separate always-on service. See
[001](001-container-apps-over-container-instances.md), whose container may now be unnecessary
rather than merely deferred.

**Two security properties are load-bearing and must survive future edits.** Tenants resolve
through an allowlist in `graphToken.ts` and are never taken from a request — an anonymous
endpoint that puts a caller-supplied tenant id into a token request will attempt an
authentication against any directory it is pointed at. And `/api/tenant-probe` returns a count,
one timestamp and a status code, never a row, because the sign-in log holds other visitors'
addresses and coordinates.

**`/api/tenant-probe` is scaffolding.** Delete it once SCIM or the Admin's View exercises
`graphToken.ts` in production.

## Alternatives considered

**A certificate in Key Vault, in each foreign tenant.** Rejected as the default, kept as the
fallback in 003, now dead. It works, and it puts a stored credential back into a system that
has none.

**Extending the GitHub Actions OIDC pattern.** Rejected: a five-minute cron floor and
best-effort delivery cannot serve a request. This is not a criticism of the sweeps, which are
the right shape for scheduled work and remain unchanged.

**A system-assigned managed identity.** Not an option. Microsoft states only user-assigned
identities can be used as a credential **[M]**.

**Doing nothing until a module needed it.** Rejected because the answer gated the sequencing of
two modules, and the test cost about twenty minutes of portal work.
