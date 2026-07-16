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
| 003 | Cross-tenant Graph: federated identity credentials vs. client secrets | **open** — verify FIC flow at Phase 1 |
| 004 | Module 2's B2B invitation flow: how to avoid an open email relay | **open** — blocks Phase 2 |
| 005 | On-demand provisioning instead of waiting for Entra's cycle | decided, not yet written up |

Decisions 003 and 004 are open and both are load-bearing. See the spec for the options
under consideration.
