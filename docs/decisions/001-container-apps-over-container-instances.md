# 001. Container Apps over Container Instances for the SCIM mock

**Status:** decided 16 July 2026 (spec commit `cd4865a`). **Nothing built.** There is no
`scim-mock/` directory and no container deployed. Module 5 lands in Phase 6, so this
decision is priced but not exercised.

Every factual claim below is marked **[M]** if it was read in current project documentation
(source given) or **[A]** if it is assumed and still needs testing. Because nothing is
deployed, the platform-behaviour and pricing claims are **[A]**. They were researched when
the spec was written in July 2026 and have not been re-read against Microsoft's docs since.

Sources are cited by section rather than line number, because the spec moves.

---

## Context

Module 5 needs a containerised SCIM 2.0 mock with an endpoint that Entra can provision
into. Earlier drafts of the spec put it on Azure Container Instances at $3 to $8 a month,
always on. **[M]** (spec § 2 → Hosting)

That was the only always-on cost in the design. Everything else was free tier or near zero,
totalling roughly $1 to $3 a month. **[M]** (spec § 2 → Hosting, cost table)

A second problem travelled with ACI. Module 5's gotcha list carried "ACI endpoint must be
HTTPS", with a reverse proxy as the intended answer. **[M]** (spec § Module 5) That is a
component to build, deploy and maintain purely to satisfy a transport requirement.

## Decision

**Azure Container Apps, consumption plan, scale to zero.** **[M]** (spec § 2 → Hosting and
§ Tech stack; [architecture.md](../architecture.md) → The shape of it)

The reasons, all as recorded in the spec:

- It scales to zero and is covered by a monthly free grant at this volume. **[A]**
- HTTPS ingress is provided out of the box. **[A]**
- Removing the only always-on line item takes hosting to roughly nothing. **[M]**

The HTTPS point is the one worth stating separately. Container Apps ingress being HTTPS by
default does not solve the reverse-proxy problem, it removes it. There is no proxy left to
build. **[M]** (spec § Module 5, gotcha struck through and marked resolved)

## Rejected alternatives

**Azure Container Instances.** Rejected on always-on cost and on the HTTPS gap. It is out
of the design entirely, not held as a fallback. **[M]** (spec § 7 → Settled since the first
draft)

**No third option was considered.** The source prose weighs ACI against Container Apps and
nothing else. App Service containers, AKS, and running the mock inside the Function App
were never evaluated, so there is no recorded reason for rejecting them. Recorded as a gap
rather than back-filled with a plausible one.

## Consequences

**Container Apps becomes the first genuinely unbounded resource in the design.** **[M]**
(spec § 4, item 6) The runaway table traces what can actually escalate: the DNS zone is
fixed, Static Web Apps stops serving rather than billing, and the Function App has a
1M-execution free grant. Container Apps and External ID MAU are the only two that can run
away. Kill-switch automation therefore only becomes meaningful at Phase 6, when this lands.
Until then, budget alerts plus a human are proportionate for a $10/month budget.

**The provisioning target becomes an ingress FQDN.** Module 5 registers a non-gallery
enterprise app whose tenant URL is the Container Apps HTTPS ingress hostname, with the
secret token from Key Vault. **[M]** (spec § Module 5)

**"Covered by the free grant" is untested and carries the money.** Volume here is a public
endpoint that Entra provisions into on its own cycle, plus whatever else reaches a public
URL. The claim holds at demo volume and has never been measured. **[A]**
