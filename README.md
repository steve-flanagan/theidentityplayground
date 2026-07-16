# The Identity Playground

**Live site:** _(not yet deployed — Phase 0)_ · **Domain:** theidentityplayground.com

Identity work is invisible in production. This site makes it visible.

Visitors sign in for real — as a customer, a business guest, or an employee — and each
module shows exactly what happened underneath: the tokens that were issued, the policies
that applied, the provisioning calls that fired. Every module links to the Entra
configuration and the source that produced it.

Built on Microsoft Entra by **Steven Flanagan**.

> **Status: Phase 0 (scaffolding).** The site is never "unfinished," just growing — the
> roadmap is on the homepage. See [the build spec](identity-playground-spec.md) for the
> full module design and phase plan.

## Why the tenants are separated

Three tenants, and the separation is itself part of the demo:

| Tenant | Purpose |
|---|---|
| **External ID tenant** | Customer/CIAM sign-ups. The main public entry point. |
| **Demo workforce tenant** | Fake employees, B2B guests, SCIM provisioning source, sign-in logs. |
| **Steve's real tenant** | **Never used for identity.** It only owns the Azure subscription that pays for hosting. |

No real account, credential, or record exists in either demo tenant. Every demo account
self-destructs within 24 hours — that lifecycle job is itself Module 7.

## Architecture

See [docs/architecture.md](docs/architecture.md). Short version: React SPA on Azure Static
Web Apps, Azure Functions backend, Node throughout, Entra doing the actual identity work.

```
web/         React SPA (Vite + Tailwind)
api/         Azure Functions backend
scim-mock/   Containerized mock SaaS app with a SCIM 2.0 endpoint
scripts/     PowerShell + Graph: tenant setup, lifecycle cleanup
infra/       Bicep templates
docs/        Architecture, tenant setup, and decision records
```

## Running locally

```bash
npm install --prefix web
npm run dev --prefix web      # http://localhost:5173
```

Phase 0 needs no tenant configuration and no secrets — there is nothing to sign into yet.

## Decisions

Design decisions and their reasoning live in [docs/decisions/](docs/decisions/). They are
the most interesting reading in this repo.
