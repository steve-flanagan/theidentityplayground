# Decision records

Short ADRs: what was decided, what was rejected, and why. One file per decision,
numbered. Keep them short — the reasoning matters, the ceremony doesn't.

Format: **Context** (what forced a choice) → **Decision** → **Rejected alternatives**
(and why) → **Consequences** (including what this makes harder).

## Index

| # | Decision | Status |
|---|---|---|
| 001 | Container Apps over Container Instances for the SCIM mock | decided, not yet written up |
| 002 | Azure DNS over Cloudflare for the domain | decided, not yet written up |
| 003 | [Cross-tenant Graph for the demo-account cleanup](003-cross-tenant-graph.md) | decided |
| 004 | Module 2's B2B invitation flow: how to avoid an open email relay | **open** — blocks Phase 2 |
| 005 | On-demand provisioning instead of waiting for Entra's cycle | decided, not yet written up |
| 006 | Standalone Function App over SWA managed API (timer triggers vs. $9/mo) | decided, not yet written up |
| 007 | TypeScript over JavaScript across web/ and api/ | decided, not yet written up |

Decision 004 is open and load-bearing. See the spec for the options under consideration.

Records carry a **Status** line and mark each factual claim **[M]** (read in current
documentation, source and date cited) or **[A]** (assumed, still to be tested). 003 is the
first one written and sets that format.
