# 004. Proof of control before a B2B invitation is sent

**Status:** decided 20 July 2026. **SUPERSEDED 24 July 2026, and never built.** Module 2
shipped without it, because the design it guards was retired rather than implemented.

**What changed.** This decision exists because the planned B2B door took an email address
from an anonymous visitor and called Graph `POST /invitations`, which makes the site an
open email relay: anyone could have made Microsoft send mail to any address on our behalf.
Module 2 instead ships a **self-service sign-up user flow** (`B2X_1_B2B`). The visitor
authenticates with a provider they already control and the guest object is created on the
way through, so **no invitation is sent, no address is accepted from a stranger, and there
is no relay to abuse.** The threat this record was written against does not exist in the
shipped design. See [009](009-workforce-guest-cleanup.md) § Context and `notes/design.md`
§ 6.

**Read it for the reasoning, not the plan.** The proof-of-control analysis stands and would
apply again to anything that mails a stranger on the visitor's say-so.

**Two things in the original status line were also wrong before this.** `api/` has been
deployed since 21 July ([006](006-standalone-function-app.md), and `notes/environment.md`
owns the live state), and Phase 2 did ship. The old line read: *"Not built. Module 2 is
Phase 2, and `api/` deploys nothing yet. This is the blocker Phase 2 does not ship
without."* It contradicted this record's own Consequences section, which already said the
backend exists.

Every factual claim below is marked **[M]** if it was read in current documentation (source
and date given) or **[A]** if it is assumed and still to be tested. Microsoft-behaviour
claims were read on Microsoft Learn on 20 July 2026, not verified against a live tenant.

Sources are cited by section rather than line number, because files move.

---

## Context

Module 2 ("Three Doors") demonstrates B2B guest invitation. The obvious build calls Graph
`POST /invitations` with an address the visitor typed. On a public site with anonymous
visitors that is an open email relay: anyone enters `victim@theircompany.com` and the tenant
sends real mail to an address that never consented. **[M]** (spec, Module 2 blocker note.)
The problem is not volume, so rate limiting does not solve it. It is sending unsolicited mail
to a non-consenting address at all.

**Microsoft's native controls do not cover this.** External collaboration settings offer
domain allow/block lists and restrictions on which roles may invite, but both assume the
inviter is a trusted internal user. **[M]**
([allow-deny-list](https://learn.microsoft.com/en-us/entra/external-id/allow-deny-list),
[external-collaboration-settings-configure](https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure),
read 20 July 2026.) Here the inviter is the app's own identity acting for an anonymous
visitor, so "who can invite" is moot and a domain allowlist would defeat the demo.

**The stakes are not only spam.** Microsoft applies its own tenant-level abuse block:
invitations that look abusive get B2B invite capability frozen directory-wide with a 403, and
only Microsoft support can lift it, not a config change. **[M]** (Microsoft Learn / Q&A on
directory-level invitation blocks, read 20 July 2026.) An open relay risks the whole tenant's
invite capability, not just its reputation.

## Decision

**Prove control of the target address before any invitation is sent.** The visitor requests
an invite to address X; the app sends a one-time code to X; only after that code is entered
does the app call `POST /invitations` for X. You can only invite an address you can already
receive mail at, which closes the relay by construction rather than by policy.

This is an **app-layer control, not a Microsoft feature.** Email one-time passcode in B2B is a
guest *redemption* method, not a pre-invite check, so there is no native control for this and
it has to be built. **[M]** (Microsoft Learn, email one-time passcode is redemption-side.)

## Rejected alternatives

**Domain allow or block list, the Microsoft-native lever.** It does not fit. An allowlist
kills the demo, whose point is inviting an arbitrary guest. A blocklist of personal domains
still lets a relay reach corporate addresses. Considered as a *complement* to OTP and dropped
on 20 July: once OTP proves control of the address, the domain is irrelevant, so a blocklist
adds nothing except blocking a visitor from inviting their own personal address, which is
legitimate demo use. (Steve.)

**Hard tenant-wide daily cap.** Cheaper, but it rate-limits abuse instead of preventing it and
still sends some unsolicited mail, which is the exact thing that trips the tenant-level block.
Rejected because the problem is unsolicited mail at all, not its rate.

**Pre-redeemed guest account, no live invite.** Zero abuse risk, but the weakest demo. Nothing
happens live, and the module exists to show the flow.

## Consequences

- **The invite flow gains a step:** request, code to the target, verify, invite. That step
  *is* the security demonstration, so it is content, not overhead.
- **It needs the backend, which now exists.** Sending the code and holding the short-lived
  pending-invite state requires a Function App. [Decision 006](006-standalone-function-app.md)
  is implemented as of 21 July, so the invite/OTP endpoint has a home. Still unbuilt: that
  endpoint itself, its cross-tenant Graph auth into the workforce tenant, and an email channel
  for the code. **[M]**
- **No personal-domain blocklist**, per the decision above.
- **The pending code is short-lived and per-address.** Do not persist target addresses beyond
  the verification window; they are third-party PII, which is the whole sensitivity here.
