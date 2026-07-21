# 004. Proof of control before a B2B invitation is sent

**Status:** decided 20 July 2026. **Not built.** Module 2 is Phase 2, and `api/` deploys
nothing yet. This is the blocker Phase 2 does not ship without.

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
- **It needs the backend.** Sending the code and holding the short-lived pending-invite state
  requires a Function App, which reopens [006](006-standalone-function-app.md) exactly as
  decision 008 would. `api/` deploys nothing today. **[M]** (`deploy-web.yml`, `api_location: ""`.)
- **No personal-domain blocklist**, per the decision above.
- **The pending code is short-lived and per-address.** Do not persist target addresses beyond
  the verification window; they are third-party PII, which is the whole sensitivity here.
