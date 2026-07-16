# Architecture

> **Stub — Phase 0.** Fill in as the system becomes real. The authoritative design lives
> in [the build spec](../identity-playground-spec.md); this document is the reader-facing
> version, and should end up with a diagram at the top.

## The shape of it

- **Front-end:** React SPA (Vite + Tailwind) on Azure Static Web Apps. MSAL.js handles all
  auth. No Graph tokens ever reach the browser.
- **Backend:** Azure Functions (Node.js). Talks to Graph on behalf of the demo tenants.
- **SCIM mock:** Node/Express app on Azure Container Apps, exposing a SCIM 2.0 endpoint
  that Entra provisions into.
- **State:** Azure Table Storage for the event feed and demo data.
- **Secrets:** Key Vault, read via the Function's managed identity.

## The two axes people conflate

**Identity** and **hosting** are separate concerns here, and keeping them separate is the
whole security argument:

- **Identity** lives in two throwaway demo tenants. Public visitors only ever authenticate
  against those. Steve's real tenant issues no tokens to anyone.
- **Hosting** lives in one resource group in Steve's existing pay-as-you-go subscription.
  That subscription belongs to his real tenant — which is fine, because a DNS zone and a
  static file host contain no identity.

The resource group is the blast-radius boundary: one budget scope, one RBAC boundary, and
one `az group delete` to erase the project.

## The cross-tenant Graph hop

The sharpest constraint in the design. A managed identity is a service principal in the
tenant that owns the subscription — Steve's real tenant. It therefore **cannot** hold
Graph application permissions in either demo tenant, which is where all the interesting
Graph work happens (modules 2, 5, 6, 7).

See decision 003. Preferred approach is a managed identity federated against a
multi-tenant app registration in each demo tenant, which needs no client secrets at all.
Fallback is client credentials in Key Vault.

## To be written

- Architecture diagram (top of this file, and the README)
- Per-module data flow
- The Graph permission inventory — every application permission, per Function, with the
  justification for each
