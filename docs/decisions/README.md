# Decision records

Short ADRs: what was decided, what was rejected, and why. One file per decision,
numbered. Keep them short — the reasoning matters, the ceremony doesn't.

Format: **Context** (what forced a choice) → **Decision** → **Rejected alternatives**
(and why) → **Consequences** (including what this makes harder).

## Index

| # | Decision | Status |
|---|---|---|
| 001 | [Container Apps over Container Instances for the SCIM mock](001-container-apps-over-container-instances.md) | decided |
| 002 | [Azure DNS over Cloudflare for the domain](002-azure-dns-over-cloudflare.md) | decided |
| 003 | [Cross-tenant Graph for the demo-account cleanup](003-cross-tenant-graph.md) | decided |
| 004 | Module 2's B2B invitation flow: how to avoid an open email relay | **open** — blocks Phase 2 |
| 005 | ~~On-demand provisioning instead of waiting for Entra's cycle~~ | **withdrawn** — not a decision |
| 006 | [Standalone Function App over SWA managed API (timer triggers vs. $9/mo)](006-standalone-function-app.md) | decided |
| 007 | [TypeScript over JavaScript across web/ and api/](007-typescript-over-javascript.md) | decided |
| 008 | Self-service account deletion: how a visitor deletes their own demo account | **open** — gated behind Phase 0.5 |

Decision 004 is open and load-bearing. See the spec for the options under consideration.

**005 was withdrawn on 20 July and the number is retired.** It was never a decision.
On-demand provisioning is the feature built for this case, and the alternative it was
supposedly weighed against, making a visitor wait out a provisioning cycle during a live
demo, was never a candidate. Nothing was given up, so there is nothing to record. It
reached this index because a spec line called it "the module's key design decision", which
it is not; it is an implementation note and it lives with Module 5's design.

**The test, since this one got through it:** if you cannot name what was given up, it was
not a decision. A record with no real rejected alternative is a record with a hole in the
section that carries all the value.

Decision 008 was raised 20 July. Scheduled cleanup is *meant* to remove accounts after 24
hours, and as of 20 July it has run unattended without ever reaching a deletion, so treat
that premise as configured rather than proven. On the assumption it holds, this is about
immediacy and about the principle rather than necessity. It needs a decision
because the obvious implementation is a public endpoint that deletes users, which is the
highest-risk surface on the site. The shape that is safe: the SPA sends its ID token, the
backend validates it and reads `oid` from the validated token, and deletes only that user.
An account id accepted from the client turns delete-me into delete-anyone. `api/` deploys
nothing today, so this also reopens 006.

Records carry a **Status** line and mark each factual claim **[M]** (read in current
documentation, source and date cited) or **[A]** (assumed, still to be tested). 003 is the
first one written and sets that format.
