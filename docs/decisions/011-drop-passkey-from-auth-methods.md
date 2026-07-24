# 011. Drop passkey from the Auth Methods Arena

**Status:** decided 24 July 2026 by Steve. Module 3 ships without a passkey leg.

Every factual claim is marked **[M]** if it was read in current documentation (source and
date given) or **[A]** if it is assumed.

---

## Context

Module 3's spec lists four methods: email + password, email OTP, social, and **passkey**.
Passkey was the headline, and the spec called it out as current-gen expert signal.

**Passkey registration in an external tenant requires a verified custom URL domain. [M]**
(spec §3 Module 3 gotchas, re-confirmed on the §6 verify-at-build-time list.) The apex
`theidentityplayground.com` is verified on the **workforce** tenant, so the External ID
tenant cannot have it and needs a subdomain **[M]** (`notes/environment.md`).

The spec priced that subdomain as trivial: *"The subdomain is a plain CNAME — only the apex
forces the delegation."*

**That is wrong, and it is the finding this record exists for.** Microsoft's how-to makes
Step 3 of enabling a custom URL domain *"Create a new Azure Front Door instance"*, Standard
or Premium tier, with the subdomain CNAME'd at the Front Door endpoint and
`<tenant>.ciamlogin.com` as the origin. No alternative is documented anywhere on the page.
**[M]** ([how-to-custom-url-domain](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-custom-url-domain),
ms.date 2024-12-03, updated 2026-02-06; fetched and read directly 24 July 2026.)

**Azure Front Door Standard carries a base fee of roughly $35/month, always on, before any
traffic. [A]** Read from public pricing summaries rather than a live Azure quote, so treat
the figure as an order of magnitude, not a bill.

That is **3.5x the project's entire $10/month budget**, for one leg of one module, in
exactly the always-on resource shape this project has already re-architected twice to
avoid: [001](001-container-apps-over-container-instances.md) killed a $3–8/mo container and
[006](006-standalone-function-app.md) refused SWA Standard at $9/mo.

The string "Front Door" appeared nowhere in the repo before 24 July. The cost was invisible
because the prerequisite was recorded as a DNS record.

## Decision

**Module 3 ships with email + password, email OTP, and social. No passkey.**

The custom URL domain is not bought, and Front Door is not deployed.

## What is given up, stated plainly

**The strongest current-gen authentication signal on the site.** Passkeys are the thing an
IAM interviewer in 2026 most expects to see demonstrated, and the module's own spec framed
it that way. This is a real loss and it is not being dressed up as a scope refinement.

Also given up: a branded CIAM sign-in page. That was always a side benefit of the same
domain, and it goes with it.

## Rejected alternatives

**Pay for Front Door.** ~$35/mo against a $10/mo budget, for one demo leg. Rejected on cost
alone. Reconsider if the budget ever changes shape, because everything else about the leg is
already understood.

**Keep passkey and hunt for a non-Front-Door route.** A Microsoft Q&A thread titled
"Enable custom URL domains without using frontdoor" exists, which suggests others want the
same thing, but the official how-to documents only the Front Door path and no alternative
was verified. **[A]** Rejected as speculative: an unverified workaround is not a plan, and
the cost of finding out is Steve's time on the one thing the budget already rules out.

**Move the CIAM login to the workforce tenant to reuse the verified apex.** Rejected: the
whole point of the External ID tenant is that customers are not workforce identities, which
is Module 2's entire argument. Breaking that to save a DNS record would contradict the site's
own thesis.

**Demonstrate passkey against the workforce tenant instead.** Not evaluated in depth. Worth a
look if passkey is ever revived, since that tenant already holds the verified apex, but a
workforce passkey demo is a different story from a customer one and it is not what Module 3
was for. **[A]**

## Consequences

**Module 3 becomes a days-shaped module rather than a week-plus.** What remains is tenant
configuration, HAR captures, and wiring onto the timeline that already exists. It has no
infrastructure decision left in it.

**The dev loop stops being deploy-only.** A passkey binds to one origin as its relying
party, so localhost and production would have been separate relying parties and the leg
could only ever have been tested against the live domain **[M]** (spec §3 Module 3
gotchas). Dropping it keeps Module 3 inside the ordinary localhost loop.

**The `amr` problem is now the module's main open risk, not the domain.** This tenant issues
no `amr`, `acr` or `auth_time` **[M]** (`notes/findings.md`), and the module's original
premise was watching `amr` change between methods. The fallback is the flow instrumentation
already shipped in `JourneyTimeline` — the timeline shows the methods differing by their
actual request sequence rather than by a claim. Verify before building.

**Say it on the site.** A module about authentication methods that omits the most modern one
should say why: the platform requires a custom domain, the custom domain requires Front Door,
and that is a real constraint an IAM engineer would hit. Annotating the absence is more
credible than a silent gap, and this project already treats that as a principle
(`notes/design.md` §4, "an artifact that annotates its own gaps is more credible than a
complete one").
