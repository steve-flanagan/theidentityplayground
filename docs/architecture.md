# Architecture

> **Stub — Phase 0.** Fill in as the system becomes real. The authoritative design lives
> in [the build spec](../identity-playground-spec.md); this document is the reader-facing
> version.

<p align="center">
  <img src="architecture.svg" alt="A visitor opens the React SPA, which signs in at External ID. External ID redirects out to a federated identity provider and gets an assertion back, then returns an ID token to the SPA. Separately, GitHub Actions runs a keyless scheduled cleanup against External ID." width="760">
</p>

## The shape of it

- **Front-end:** React SPA (Vite + Tailwind) on Azure Static Web Apps. MSAL.js handles all
  auth. No Graph tokens ever reach the browser.
- **Backend:** Azure Functions (Node.js), not deployed yet (`api/` is a single health
  endpoint). The one piece of Graph work that runs today, the demo-account cleanup, runs
  from GitHub Actions instead. See the cross-tenant hop below.
- **SCIM mock:** Node/Express app on Azure Container Apps, exposing a SCIM 2.0 endpoint
  that Entra provisions into.
- **State:** Azure Table Storage for the event feed and demo data.
- **Secrets:** Key Vault, read via managed identity once the backend exists. The cleanup
  needs none.

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
tenant that owns the subscription, which is Steve's real tenant. It therefore **cannot**
hold Graph application permissions in either demo tenant, which is where all the
interesting Graph work happens (modules 2, 5, 6, 7).

What runs today solves this without a managed identity and without a secret. The cleanup
job is GitHub Actions: it requests an OIDC token and exchanges it at Entra against a
federated credential on an app registration inside the demo tenant, which returns a Graph
token. Keyless, and the app registration lives where the permissions are needed. See
[decision 003](decisions/003-cross-tenant-graph.md) for the full reasoning and its
consequences, chief among them that push access to `main` becomes user-delete in that
tenant, which is why `main` is branch-protected.

## To be written

- Per-module data flow
- The Graph permission inventory: every application permission, per Function, with the
  justification for each
