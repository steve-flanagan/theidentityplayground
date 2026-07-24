# Identity Playground — Build Specification

**Owner:** Steven Flanagan
**Purpose:** Public, interactive portfolio project demonstrating enterprise Microsoft Entra IAM skills. Visitors experience live identity scenarios; each module shows what happened under the hood.
**Spec date:** July 2026. Entra features move fast — see "Verify before building" at the end for anything that may have changed.

---

## 1. Project summary

One public website with a grid of interactive identity scenario modules. Each module has three parts:

1. **The live demo** — visitor actually does the thing (signs in, triggers MFA, watches a user get provisioned).
2. **The "what just happened" panel** — plain-English + technical breakdown of the flow that just ran, updated live.
3. **"See the config"** — link to the exact Entra configuration and code in the GitHub repo.

The differentiator: identity work is invisible in production. This makes it visible.

**Audience:** IAM hiring managers, recruiters, interviewers. Secondary: the Entra community (blog/LinkedIn content per module).

---

## 2. Architecture

### Tenants (three, deliberately separated — the separation IS part of the demo)

| Tenant | Purpose | Cost |
|---|---|---|
| **External ID tenant** | Customer/CIAM sign-ups, the main public entry point | Free to 50,000 MAU |
| **Demo workforce tenant (new)** | Fake "employee" accounts, B2B guest scenarios, SCIM provisioning source, sign-in log dashboard | One Entra ID P1 ≈ $6/mo — but **acquisition is now blocked, see below** |
| **Steve's existing tenant** | Never used for identity. Owns the Azure subscription that pays for hosting — that's all. | — |

Document the tenant-separation rationale in the README — it demonstrates correct security architecture thinking.

**Status (July 2026):** External ID tenant created — `theidentityplayground.onmicrosoft.com`, org name "The Identity Playground". Resource group and Azure DNS zone created; delegation to Azure DNS verified live on public resolvers. Demo workforce tenant **created 17 July 2026**; the blocker below is resolved. It carries the custom domain, which is why External ID cannot and a branded CIAM login needs a subdomain. One risk on it is open and tracked in the environment notes, which owns live infra state: it sits on a trial subscription with an unknown expiry. The budget gap that used to be listed beside it was closed on 20 July.

> ### ✅ Resolved 17 July 2026. Kept because the constraint is real and would apply again
>
> The tenant exists. Everything below is why it was hard, retained for the next time a
> workforce tenant is needed. It is no longer a live blocker on any phase.
>
> **Microsoft now requires a *paid* Entra ID P1 or higher to create a workforce tenant from within an existing tenant. Trial P1/P2 licences explicitly do not qualify** — this was tightened deliberately after their security team found free trial-tenant creation being used for fraud and abuse. The result is a chicken-and-egg: you need a paid licence in a tenant to create the tenant you'd put the licence in.
>
> **It blocked Phase 2, never Phase 0 or 1.** Modules 1, 3, and 4 run entirely on the External ID tenant. The workforce tenant is first needed by Module 2.
>
> **The escape hatch: don't create it from inside the existing tenant.** The restriction applies to the Entra admin center's "Manage tenants → Create" path. Signing up as a *new customer* provisions a tenant through the ordinary onboarding flow, which that restriction doesn't cover. Ranked:
>
> 1. **M365 Developer Program** — free, renewable E5 sandbox (includes Entra ID P2). Requires a Visual Studio Professional/Enterprise *standard* subscription, or eligibility via ISV Success / AI Cloud Partner / Premier or Unified Support. **Check this first — if Steve qualifies through work, the licensing problem disappears entirely and costs $0.**
> 2. **Fresh Azure account signup** with a different email → provisions a new tenant → activate the Entra ID P2 trial *inside* it (the restriction is on tenant *creation*, not on trial activation) → buy one P1 (~$6/mo) when the trial lapses.
>
> **Billing trap:** Azure Cost Management budget alerts **do not cover M365/Entra licence billing** — that's a separate billing system. The budget alerts in section 4 will not catch a licence charge or a trial converting to paid. Licence spend needs its own calendar reminder; there is no automated backstop.

### Hosting (all on existing Azure pay-as-you-go subscription)

| Component | Service | Tier | Est. cost |
|---|---|---|---|
| Front-end (SPA) | Azure Static Web Apps | Free | $0 |
| Backend API | Azure Functions (consumption) | Free grant: 1M executions/mo | ~$0 |
| SCIM mock app (module 5) | Azure Container Apps | Consumption, scale-to-zero | ~$0 within monthly free grant |
| DNS | Azure DNS (public zone) | Standard | ~$0.50/mo |
| Secrets | Azure Key Vault | Standard | <$1/mo |
| State (event feed, demo data) | Azure Table Storage or Cosmos DB free tier | — | ~$0 |
| **Total** | | | **~$1–3/mo** (+ ~$6/mo for the single P1 — see tenant table) |

**Decision — Container Apps, not Container Instances.** Earlier drafts specified ACI at $3–8/mo always-on. Container Apps scales to zero, is covered by a monthly free grant at this volume, and provides HTTPS ingress out of the box — which also dissolves the "ACI endpoint must be HTTPS" problem in Module 5 rather than solving it with a reverse proxy. ACI was the only always-on cost in the design; removing it takes hosting to roughly nothing. Write this up in `docs/decisions/` — it's a clean cost-vs-architecture ADR.

Reuse the Cost Management budget-alert pattern from the pipeline project (tiered alerts at 50/67/100%).

### Decision — the backend is a standalone Function App, not SWA's managed API

Static Web Apps offers two ways to host a backend, and they are not equivalent:

| | Managed Functions | Bring-your-own Function App |
|---|---|---|
| Triggers | **HTTP only** — no timer, no Durable | Full Functions feature set |
| SWA plan | Free | **Standard (~$9/mo)** |

**Module 7's lifecycle cleanup is a timer trigger**, so managed Functions cannot host this backend. But the obvious fix — SWA Standard plus a linked backend — costs ~$9/mo, which triples hosting for convenience we don't need.

**Decision:** SWA Free hosts the **static site only**. The entire backend, including timer triggers, lives in **one standalone Function App on consumption** (free grant: 1M executions/mo). The SPA calls it cross-origin.

**Consequences, including what this makes harder:**
- CORS must be configured on the Function App (allowlist the site origin). One-time setup, not a project.
- No same-origin `/api` proxying — the SPA calls the Function App's own hostname. Expect the "why isn't the API behind `/api`?" question in an interview; the answer is this table.
- SWA's built-in auth is unused — irrelevant, since MSAL does all auth per section 2.
- Two deployments (SWA + Function App) instead of one.
- **Cost: ~$0 instead of ~$9/mo.**

Write this up in `docs/decisions/` — it's a clean "read the constraints, then price them" ADR.

### Subscription, tenants, and the cross-tenant Graph hop

**Azure resources all live in the existing pay-as-you-go subscription, inside one dedicated resource group** (e.g. `rg-identityplayground`). That RG is the isolation boundary that matters: one budget scope, one RBAC boundary, one `az group delete` to erase the project. A second subscription or tenant buys nothing here.

**The "never expose your real tenant" rule is about identities, not hosting.** Users, guests, app registrations, and tokens that public visitors touch stay in the two demo tenants. Which subscription pays for a DNS zone or a static file host is a different axis entirely — a DNS zone contains no identity.

**Dependency direction (easy to get backwards):** an external tenant links *to* an existing Azure subscription for billing — the portal asks you to pick a subscription and resource group when creating it. The subscription is the prerequisite; you do not create a tenant to obtain one. A 30-day trial tenant can be created without a subscription link, which is a fine way to start. Creating the tenant requires the **Tenant Creator** role scoped to the subscription or to an RG within it.

**The cross-tenant Graph hop — the design's sharpest constraint.** A Managed Identity is a service principal in the tenant that owns the subscription (Steve's existing tenant). **It cannot be granted Graph application permissions in the External ID or demo workforce tenants.** Managed identity alone therefore cannot do the Graph work in modules 2, 5, 6, or 7. Two viable designs:

| Approach | How it works | Trade-off |
|---|---|---|
| **App registration + client credentials** (baseline) | App registration in each demo tenant; secret/cert in Key Vault; Function's MSI reads Key Vault (same tenant — that hop works fine) | Proven, simple. But secrets exist, and secrets need rotation. |
| **MSI + federated identity credentials** (preferred, verify first) | Multi-tenant app registration in each demo tenant, with a federated identity credential trusting the Function's MSI. MSI token is exchanged as a client assertion for a token in the demo tenant. | **No client secrets anywhere.** Strictly better security story and better portfolio material. Confirm the FIC flow works external-tenant→workforce-tenant before committing. |

Try the federated approach at Phase 1; fall back to client credentials if it doesn't hold. Either way the decision goes in `docs/decisions/` — "how I did cross-tenant Graph without secrets" is exactly the writeup an IAM interviewer wants to read.

> **Multi-tenant app registrations ARE available in external tenants** — verified in the portal on 16 July 2026, which showed "Multiple Entra ID tenants" as a selectable account type in the External ID tenant. (An earlier draft of this spec claimed otherwise, based on a secondary source rather than the product. Wrong, and corrected.) So the FIC pattern is not ruled out on that basis in either tenant. It remains unverified end to end — build it and see.

### Domain & DNS

**Domain:** `theidentityplayground.com`, registered at GoDaddy (3yr, purchased July 2026).

**This is a hard dependency, not cosmetics.** Passkeys in External ID external tenants *require* a verified custom URL domain — no domain, no Module 3 passkey. Two constraints follow:

- **Settle the domain before building Module 3.** A passkey binds to a single domain as its relying party, and Entra does not yet support related origins. Changing the domain later invalidates every registered passkey.
- **DNS must be delegated away from GoDaddy.** Pointing the apex (`theidentityplayground.com`, no `www`) at Static Web Apps requires an ALIAS/ANAME record or CNAME flattening, and GoDaddy's DNS supports none of them. Registration stays at GoDaddy; nameservers point at **Azure DNS**, which handles apex→SWA via alias records and is Microsoft's documented answer to exactly this registrar gap.

Azure DNS over Cloudflare (which is free and would also work): it keeps the project to one vendor and one budget, and a DNS zone is Bicep-templatable — making the `infra/` stretch goal real portfolio material instead of a checkbox in a web console.

**Names needed** (one registration covers both): apex for the site, and `login.theidentityplayground.com` as the Entra custom URL domain. The subdomain is a plain CNAME — only the apex forces the delegation.

### Repo layout (single monorepo)

```
theidentityplayground/     # Named to match the domain — keep repo, folder, and site name identical
├── README.md              # Project story, architecture diagram, module index
├── docs/
│   ├── architecture.md
│   ├── tenant-setup/      # Step-by-step Entra config per module (screenshots ok)
│   └── decisions/         # Short ADRs: why X over Y (great interview material)
├── web/                   # SPA front-end
├── api/                   # Azure Functions backend
├── scim-mock/             # Containerized mock SaaS app with SCIM 2.0 endpoint
├── scripts/               # PowerShell + Graph: tenant setup, lifecycle cleanup
└── infra/                 # Bicep templates for the Azure resources (stretch goal)
```

### Tech stack

- **Front-end:** React SPA (Vite). MSAL.js (`@azure/msal-browser` / `@azure/msal-react`) for all auth. Tailwind for styling.
- **Backend:** Azure Functions, Node.js (keeps one language across front/back; Claude Code handles this well).
- **Graph access:** Never expose Graph tokens to the browser. Application permissions kept to the minimum per module (document each permission and why — that's an IAM skill on display). **This is a cross-tenant problem — see "Subscription, tenants, and the cross-tenant Graph hop" below.** Earlier drafts said "Managed Identity *or* app registration with client credentials"; that `or` was wrong, and the correction is architectural.
- **Automation/ops scripts:** PowerShell + Microsoft Graph PowerShell SDK (your home turf — these scripts are portfolio pieces themselves).
- **SCIM mock:** Small Node.js (Express) app implementing SCIM 2.0 `/Users` endpoints, containerized, deployed to Azure Container Apps.

---

## 3. Modules

Ordered by build sequence, not homepage order. Each lists: experience, what it proves, implementation, Entra config, licensing, gotchas.

---

### Module 1 — Token Inspector (build first; everything feeds it)

**Visitor experience:** After any sign-in anywhere on the site, a panel decodes their own ID token and access token in the browser. Each claim is annotated: what it is, why it's present, which tenant config produced it. Hover a claim → explanation. Toggle between "raw JWT" and "annotated" views.

**Proves:** Deep understanding of tokens, claims, OIDC — the thing interviewers actually probe.

**✅ Shipped and working (16 July 2026).** Verified against a real account in Firefox: MSAL sign-in → inspector reads the visitor's own ID token → 16 claims annotated across 5 categories. The `iss` gotcha rendered exactly as documented — the real token's issuer host is the tenant-GUID subdomain, not the configured authority host.

> **⚠️ Finding that threatens Module 3: this tenant's ID tokens carry NO `amr`, `acr`, `auth_time`, or `idp`.**
> The whole Authentication category of the claim dictionary is empty against a real token. `optionalClaims` on the app registration is unset, which explains `auth_time`, but there's a deeper issue: **`amr` and `acr` were v1.0 claims and appear to be absent from v2.0 tokens by design** (v2.0 aims at OIDC standard-compliance). This token is `ver: 2.0`.
>
> **Module 3's premise is "watch `amr` change from `pwd` → `mfa` → `fido` as you try each method."** If `amr` is unobtainable, that module needs redesigning rather than debugging — the fallback is to visualise the flow from SPA instrumentation (navigation + MSAL events, which the spec already calls for) and drop the claim-diffing angle.
>
> Verify before building Module 3: (a) can `auth_time` / `acrs` be added via App registration → Token configuration → Optional claims (documented as the supported CIAM path)? (b) is `amr` obtainable in a v2.0 ID token by any means? If not, say so in the UI — an honest "this platform doesn't expose it, here's what I used instead" is stronger than pretending.
>
> Note `idp` and `sid` behave correctly: `idp` is absent precisely because this was a local account (the issuer IS the IdP), and should appear once Google social login exists. The dictionary entries for those are right; they're just not exercised yet.

**Design notes for a later polish pass** (Steve, 16 July): the Raw JWT view needs pretty-printed/syntax-highlighted JSON; the click-to-expand affordance needs to be more obvious — the annotations are the entire point of the module and are currently easy to miss.

**Implementation:**
- MSAL.js exposes the raw ID token; decode client-side (base64, no signature verification needed for display — but SAY that in the UI, it's a teachable moment).
- Static claim-annotation dictionary (JSON file mapping claim names → explanations). Start with ~25 common claims (`aud`, `iss`, `tid`, `oid`, `sub`, `acr`, `amr`, `idp`, etc.).
- Highlight claims that differ based on how the user signed in (e.g., `idp` for social login, `amr` values after MFA).

**Entra config:** App registration in the External ID tenant, SPA platform, redirect URIs for localhost + production.

**Licensing:** None beyond free tier.

**Gotchas:** Access tokens for Microsoft-owned APIs (like Graph) should be treated as opaque — only decode/annotate tokens issued for YOUR registered API, plus the ID token. Annotate the ID token primarily.

---

### Module 2 — Three Doors, One App

**Visitor experience:** Three sign-in buttons: **Customer** (External ID: email signup or Google/social), **Business Guest** (B2B invitation flow into the demo workforce tenant), **Employee** (pre-made demo workforce account with displayed credentials, read-only role). After sign-in, a side-by-side comparison table: token claims, tenant ID, identity type, applied policies — versus the other two door types.

**Proves:** You understand the workforce vs. external vs. B2B distinction at a practical level — the exact Fortune-50 experience on your resume, made tangible.

**Implementation:**
- Two MSAL configurations (External ID authority vs. workforce tenant authority). The SPA switches authority based on the door chosen.
- "Employee" door: 2–3 shared demo accounts with rotating passwords (rotated by the module-7 lifecycle job), read-only permissions, session-only.
- B2B door: visitor enters an email → backend calls Graph `POST /invitations` in the demo workforce tenant → visitor redeems the invite live and sees their guest token.
- Store the visitor's tokens from each door (session storage in-memory) to feed the comparison table via Module 1's inspector.

**Entra config:** App registrations in both tenants; B2B invite settings; guest user restrictions locked down (guests see only the demo app, no directory read).

**Licensing:** B2B guests bill under External ID MAU (free to 50k). Free tier otherwise.

**Gotchas:**
- Lock down what guests/demo employees can do: assign no roles, restrict default user permissions in the demo workforce tenant, disable guest self-service where possible.
- Shared demo credentials on a public site = design the account so compromise is meaningless (no privileges, auto-rotated, auto-cleaned).

> ### ✅ RESOLVED by design change, 23 July 2026 — the B2B door never sends mail
>
> **What shipped is not what this blocker was written against.** The guest door is a
> **self-service sign-up user flow** (`B2X_1_B2B`): the visitor authenticates with a
> provider they already control and the guest object is created on the way through. No
> address is accepted from a stranger, no `POST /invitations` call is made, and the tenant
> sends no mail. The relay does not exist to be abused.
>
> [Decision 004](docs/decisions/004-b2b-invitation-proof-of-control.md) was written to solve
> this and is **superseded** rather than implemented. Its proof-of-control reasoning still
> applies to anything that ever mails a stranger on a visitor's say-so.
>
> The original blocker text is kept below, because the threat model is still correct for the
> design it describes and this is the clearest example in the repo of a security problem
> removed by changing the design instead of defending it.
>
> <details>
> <summary>The original blocker, as drafted</summary>
>
> As drafted, any visitor types any address and the backend calls Graph `POST /invitations`, causing **Microsoft to send real mail from your tenant to a third party who never consented**. A visitor can enter `victim@theircompany.com` repeatedly and your tenant is the sender. The site-wide per-IP rate limiting in section 4 does **not** cover this — the problem isn't volume, it's sending unsolicited mail to a non-consenting address at all. Outcome if abused: your demo tenant gets spam-reported, which is a uniquely bad look for this particular portfolio piece.
>
> Pick one before writing the invite call:
> 1. **Prove control first** — visitor completes an OTP to that address before any invitation is issued. Best demo (it's a real identity-proofing step, on-theme), most work.
> 2. **Hard global cap** — invitations/day tenant-wide, not per-IP, with the door disabling itself on cap. Cheap, still sends some unsolicited mail.
> 3. **Drop the live invite** — pre-redeemed guest account, visitor sees the resulting guest token. Zero risk, weakest demo.
>
> Decision goes in `docs/decisions/` either way — the writeup is itself interview material.
>
> </details>

---

### Module 3 — Auth Methods Arena

**Visitor experience:** Try different sign-in methods on demo flows: email + password, email OTP, social (Google), and **passkey**. A step-by-step visualization renders the actual redirect/request/token exchange as it happens (sequence-diagram style, animating each leg).

**Proves:** OAuth2/OIDC fluency plus current-gen authentication methods.

**Implementation:**
- Separate user flows in the External ID tenant per method, or one flow with multiple options.
- The flow visualization: instrument the SPA — record navigation events, MSAL events, and token receipt timestamps; render as an animated sequence diagram (mermaid.js or custom SVG).
- Passkey demo: guided flow — user creates an email+password demo account, completes MFA, then registers a passkey and signs in with it.

**Entra config:** Enable authentication methods in External ID tenant: Email OTP, passkey (FIDO2) policy, Google as social IdP.

**Licensing:** Passkeys are included in External ID at no additional cost. **Avoid SMS MFA** — it's a paid add-on (~$0.03/attempt) and a cost-abuse vector on a public site.

**Gotchas (verified against Microsoft Learn, July 2026):**
- Passkeys in External ID: only email+password / username+password local accounts can register one; MFA required before registration; NOT available for social-IdP or email-OTP users. Display this constraint in the UI — knowing platform limitations is expert signal.
- **Custom URL domain is required, not optional.** Confirmed: passkey registration in external tenants will not work without a verified custom URL domain. See "Domain & DNS" in section 2 — the domain is bought and the Azure DNS delegation must be done *before* this module, not during it.
- **A passkey binds to one domain as its relying party.** Related-origins support does not exist yet, so a passkey registered against one origin will not work on another. Practical consequence: localhost dev and production are separate relying parties, so plan to test passkey registration against the real domain, and never change the domain after this module ships.
- Email OTP as first factor can't also be the second factor.

---

### Module 4 — Conditional Access, Live

**Visitor experience:** Two demo paths into a "sensitive documents" page: Path A (normal account) gets in with just a password. Path B (account targeted by a CA policy) hits a live MFA challenge. After each, the panel shows the **actual CA policy JSON** (pre-exported via Graph) with the matching conditions highlighted, plus the sign-in log entry showing which policy applied.

**Proves:** CA policy design + the ability to explain policy behavior — a daily enterprise IAM task.

**Implementation:**
- CA policy in the External ID tenant: require MFA for a specific app or user group.
- Backend Function exports CA policies via Graph (`/identity/conditionalAccess/policies`) on a schedule; front-end renders the JSON with syntax highlighting and annotations.
- Pull the visitor's own sign-in log entry (see Module 6 plumbing) and show `appliedConditionalAccessPolicies`.

**Entra config:** CA policies in the external tenant (supported); MFA methods enabled per Module 3.

**Licensing:** CA in external tenants is available; check current tier requirements at build time. In the workforce tenant CA requires P1 (covered by the single P1 license).

**Gotchas:** External tenants do NOT currently support authentication strengths in CA — you can require MFA but can't require phishing-resistant MFA specifically. Note it in the UI.

---

### Module 5 — Live SCIM Provisioning

**Visitor experience:** Visitor clicks "hire a demo employee" → backend creates a user in the demo workforce tenant and adds them to a provisioning-scoped group → a live event feed shows Entra provisioning the user into the mock SaaS app via SCIM (`POST /Users` arrives at the mock endpoint) → the user appears in the mock app's user list. Then "terminate" → watch deprovisioning.

**Proves:** Provisioning/lifecycle — core IAM that almost nobody can demo live. The SCIM mock also proves you can build the app side of the integration.

**Implementation:**
- `scim-mock/`: Express app implementing SCIM 2.0 server basics: `GET/POST /Users`, `GET/PATCH/DELETE /Users/{id}`, `/ServiceProviderConfig`, `/Schemas`, filter support (`userName eq "..."`). Bearer-token auth. Microsoft publishes SCIM endpoint requirements and reference code — follow their spec doc.
- Registered as a **non-gallery enterprise app** in the demo workforce tenant with automatic provisioning configured (tenant URL = the Container Apps HTTPS ingress FQDN, secret token from Key Vault).
- Event feed: mock app writes every SCIM request it receives to Table Storage; front-end polls or uses SignalR (Functions binding) for the live feed.
- "Hire" button → Function calls Graph to create user + group membership. Provisioning then happens on Entra's cycle.

**Licensing:** **Requires Entra ID P1 in the demo workforce tenant** (provisioning to custom SCIM apps is not on the free tier). One P1 license ≈ $6/month, or start on the free 30-day P2 trial.

**Gotchas:**
- Entra's provisioning cycle runs every ~20–40 minutes. For the live demo, use **on-demand provisioning** (Graph: `synchronization/jobs/{id}/provisionOnDemand`, or the portal's "Provision on demand") triggered by your Function so the visitor sees results in seconds, not half an hour. Implementation note, not a design decision: the alternative is making a visitor wait out a cycle during a live demo, which was never a candidate. Decision 005 was raised off this line and withdrawn.
- Append `?aadOptscim062020` to the tenant URL for standards-compliant PATCH behavior if you hit PATCH issues.
- ~~ACI endpoint must be HTTPS — reverse proxy or Container Apps~~ — **resolved.** Container Apps is now the decision (section 2); its ingress is HTTPS by default, so there's no proxy to build.
- **The live feed renders attacker-controlled input on a public page — encode it.** The mock writes every SCIM request body it receives to Table Storage, and the front-end renders that feed publicly. Anything reaching the endpoint therefore reaches a public page: that's a stored-XSS path. Two controls, both required: reject unauthenticated requests at the mock (bearer token enforced on every route, not just `POST /Users`), and treat every stored value as untrusted text at render time — never `dangerouslySetInnerHTML`, never inject raw JSON into the DOM. Do not rely on "only Entra can reach this endpoint" — it's a public URL.

---

### Module 6 — The Admin's View

**Visitor experience:** A read-only "admin dashboard" showing recent sign-in activity in the demo tenants — and the visitor's **own sign-in appears in it** within seconds of them using any other module. Shows: app, identity type, auth method, MFA result, CA policies applied. Sanitized (no IPs/emails beyond the visitor's own session).

**Proves:** Graph API automation, sign-in log analysis, monitoring mindset.

**Implementation:**
- Backend Function polls Graph `auditLogs/signIns` (both tenants) every ~30s while the site is active; caches sanitized entries in Table Storage; front-end displays feed.
- Match "your sign-in" by correlating the visitor's `oid`/session with log entries.

**Licensing:** Reading sign-in logs via Graph in a workforce tenant requires P1 (same license as Module 5). Verify what the External ID tenant exposes on the free tier at build time.

**Gotchas:** Sign-in log entries can lag 1–5 minutes. Set the UI expectation ("your sign-in will appear within a few minutes") rather than promising real-time.

**Privacy rule — filter server-side, by the caller's own `oid`, always.** The API must never return another visitor's log entry to the browser under any circumstance, including "we mask it in the UI." Fetch-all-then-filter-client-side is not acceptable here: the unmasked rows are in the response body, one devtools tab away. The correlation must happen in the Function, scoped to the authenticated caller's `oid`, and only their own rows may leave the backend. Everyone else's activity is aggregate-only (counts, method types, policy names — never identifiers).

Worth over-engineering: leaking visitor A's sign-in to visitor B is an ordinary bug on most sites and a credibility-ending one on a site whose entire thesis is that you understand identity.

---

### Module 7 — Self-Destructing Accounts (lifecycle hygiene as a feature)

**Visitor experience:** A page explaining that every demo account self-destructs, showing the cleanup job's last-run stats (accounts created / deleted / current count). Optionally: a countdown on the visitor's own demo account.

**Proves:** Lifecycle management automation and security hygiene — and it's the abuse-control backbone of the whole site.

**Implementation:**
- Timer-triggered Function (or your PowerShell pattern) runs hourly: deletes external-tenant demo users older than 24h, removes redeemed B2B guests older than 24h, rotates demo-employee passwords daily, purges Table Storage state.
- Publish run stats to the front-end.
- This is non-negotiable and ships WITH Module 2, not after.

**Licensing:** Free tier (Graph user deletion needs no premium license).

---

## 4. Security & abuse controls (site-wide, not optional)

1. **Nothing real anywhere.** No real data in either demo tenant. Assume every account gets compromised; design so it doesn't matter.
2. **Rate limiting** on all backend Functions (per-IP throttling; Azure API Management consumption tier or in-code). Necessary but not sufficient — see item 8.
3. **No SMS anywhere** (cost abuse vector).
4. **Minimal Graph permissions** per Function, documented in `docs/` — the permission-scoping writeup is itself portfolio material.
5. **Demo workforce tenant hardening:** restrict default user permissions, no admin roles on demo accounts, block legacy auth, guests restricted to the demo app.
6. **Budget alerts** from day one — **and be clear that alerts do not cap anything.** Azure budgets only notify; they will not stop spend. **Live:** `budget-theidentityplayground`, $10/mo, scoped to `rg-theidentityplayground`, actual-cost alerts at 50/67/100%. (Note: the `az consumption budget` preview CLI exposes no `thresholdType`, so *forecasted* alerts aren't available through it — actual-cost only. The REST API supports them if it ever matters.)

   **Correction to an earlier draft — the "kill switch" framing was wrong for this project.** It was inherited from the pipeline project, where the runaway vector is compute. Here it isn't. Trace what can actually run away:

   | Resource | Can it run away? |
   |---|---|
   | Azure DNS zone | No — fixed ~$0.50/mo |
   | Static Web Apps (Free) | No — hard quotas; it stops serving rather than billing |
   | Function App (consumption) | Barely — 1M executions/mo free grant; rate limiting (item 2) is the real control |
   | Container Apps (Phase 6) | **Yes** — first genuinely unbounded resource in the design |
   | External ID MAU | **Yes** — and **you cannot shut this off without killing the demo** |

   So the honest controls are: **rate limiting** (item 2) and **Module 7's lifecycle job** (which deletes demo accounts and therefore holds MAU down) are the cost controls that matter. They are not merely security features — they *are* the cap. A kill-switch automation only becomes meaningful at Phase 6 when Container Apps lands. Until then, alert → human acts is proportionate for a $10/mo budget, and pretending otherwise is theatre.

   **The uncoverable gap:** Azure budgets do not see M365/Entra licence billing. If a P1 or E5 subscription is ever bought, no Azure alert will ever fire on it. That needs a calendar reminder; there is no technical backstop.
7. **Secrets in Key Vault only**; Functions use Managed Identity to read them. No secrets in repo, ever (add gitleaks or GitHub secret scanning; `.gitignore` already carries an explicit secrets block).
8. **Any endpoint that causes an email to be sent is an abuse vector, by default.** Module 2's B2B invitation is the live example (see its blocker), but the rule generalizes: if a stranger's input makes your tenant send mail, contact a third party, or incur a per-attempt charge, it needs a consent or proof-of-control step — not just a rate limit. Rate limiting throttles abuse; it doesn't make unsolicited mail consensual.
9. **Treat all demo-tenant data as attacker-controlled on the way out.** Anything a visitor can influence (SCIM payloads, display names, sign-up fields) eventually renders on a public page. Encode at render; never trust because "only Entra writes this."

---

## 5. Build phases

| Phase | Ships | Definition of done |
|---|---|---|
| **0** | Tenants + scaffolding | ✅ **Complete.** External ID tenant created; repo initialized and public; Static Web App deployed with placeholder SPA; Azure DNS delegated and apex bound via alias record; budget alert live. **Demo workforce tenant created 17 July**, ahead of need; modules 1, 3, 4 don't use it. The 0.5 gate passed on 20 July and the site is linked. |
| **0.5** | **Public-readiness gate** | ✅ **Passed 20 July 2026.** Not a build phase — a checklist that must pass before the site is *linked anywhere* (resume, LinkedIn, README), because Phase 1 puts a live sign-up form on the internet. **Rate limiting on every Function that reaches Graph:** now in place ahead of need. A standalone Function App was deployed 21 July ([decision 006](docs/decisions/006-standalone-function-app.md)) with a per-IP limiter live and verified (`200 ×5 → 429`), before any Graph-reaching endpoint exists. `deploy-web.yml` still sets `api_location: ""`; the Function App deploys separately. The first Graph endpoint ([decision 008](docs/decisions/README.md) or Module 2's invite) now ships onto a limiter that already works. **Default user permissions in the External ID tenant:** satisfied structurally rather than by a setting. External-tenant apps are limited to `openid`, `offline_access`, `User.Read` and their own APIs, and customers cannot self-consent, so a demo account has no route to a token that would let it read other users or register an app. Verified from the other end too: a customer account cannot sign in to the Azure portal. **No admin roles on any demo account:** the only non-customer principal is a B2B Member invited from the parent tenant, MFA enforced. Standing GA rather than PIM is a deliberate call given how often the account is used and what the tenant holds. **Budget alert live and RG-scoped** (✅ cannot be fired at $0 spend, so existence is the check). **Secret scanning + push protection** (✅). **No endpoint that emails a third party is reachable** (Module 2 is not in this phase — keep it that way until its blocker is resolved). Note the tenant's security now rests on that one admin account rather than on customer restrictions. |
| **1** | Module 1 + basic CIAM sign-in | ✅ **Live at https://theidentityplayground.com (16 July 2026).** Sign-up and sign-in both verified in production; the inspector reads the visitor's own ID token and annotates every claim. Google social login is live, so a federated token carries `idp` and runs 18 claims against a local account's 17. Sign-up and sign-in are told apart by a `createddatetime` claim compared against the window the flow ran in, not inferred. Lifecycle now exists: demo accounts are swept 24 to 30 hours after creation by a scheduled job. **The 0.5 gate passed 20 July and the site is linked from the README.** The delete-and-purge path is proven end-to-end as of 22 July. [ADR 003](docs/decisions/003-cross-tenant-graph.md) owns the verification status and is the only place to read it; the one item still open there is billing, not deletion. Phase 2 holds the higher bar. |
| **2** | Module 7 + Module 2 | ✅ **Complete 24 July 2026.** Lifecycle cleanup running and verified by watching real accounts expire, in **both** tenants: [ADR 003](docs/decisions/003-cross-tenant-graph.md) and [ADR 009](docs/decisions/009-workforce-guest-cleanup.md) own those statuses. Module 2 is live with all three account types. Module 7 renders both sweeps' real run history ([ADR 010](docs/decisions/010-cleanup-status-from-github-api.md)). **The invitation blocker was resolved by removing the invitation**, not by defending it: self-service sign-up means the tenant sends no mail, so the phase ships with no email relay to abuse. [ADR 004](docs/decisions/004-b2b-invitation-proof-of-control.md) is superseded rather than implemented. |
| **3** | Module 3 | Auth arena incl. passkey. **Custom domain is a prerequisite, not a deliverable of this phase** — it must already be live from Phase 0, since a passkey binds to the domain it was registered against |
| **4** | Module 6 | Admin's view dashboard |
| **5** | Module 4 | CA live demo (builds on 3 + 6 plumbing) |
| **6** | Module 5 | SCIM mock + live provisioning feed |
| **7** | Polish | Bicep templates in `infra/`, architecture diagram, per-module writeups |

Each phase is independently shippable. The site is never "unfinished," just growing — put a roadmap on the homepage.

### Queued, not scheduled — beyond Entra (Steve, 16 July)

> **Status: an idea on the shelf.** Not a phase, not costed, not decided. Recorded so it
> isn't lost, and marked so nobody builds it. This spec has previously had a pitch mistaken
> for a specification; that is not happening twice.

The site is **The Identity Playground**, not The Entra Playground. The name was chosen with
room in it, and eventually that room might hold AWS.

**The framing that decides whether this is good or bad.** Two platforms shown side by side is
*breadth*, and breadth is how a portfolio dilutes: a shallow three-platform engineer loses to
a deep one-platform engineer every time. But **the same human crossing a trust boundary** is
*depth on a new axis* — Entra issues a token, a SAML assertion crosses to AWS, STS returns
temporary credentials carrying different claims under an assumed role.

That is the same diff grammar applied to a boundary instead of a claim: *here is
the same person on both sides, here is every difference, and I control all of it.* It is also
real work in the way federating LinkedIn via custom OIDC is real work and toggling Google
isn't — **the version worth building is the federation, not the second console.**

**Why it is not now, and the reason is not doubt about the idea:** modules 2–7 do not exist.
Adding a platform before finishing one is the scope error that kills side projects.

**What it would cost, honestly — none of this is verified:**
- A **second billing surface.** The $10/mo budget is Azure-scoped to one resource group. AWS
  would need its own budget alarm, and the resource-group kill switch would no longer erase
  the whole project.
- A **second blast radius.** Every hard rule in §4 applies twice — no secrets, assume every
  demo account is compromised, lifecycle hygiene.
- **Free-tier limits on Cognito / IAM Identity Center, and whether Entra's free tier permits
  the SAML app this needs, are unverified.** Do not trust any recall of them; check before
  costing this.

---

## 6. Verify before building (things that change)

**Settled since the first draft (July 2026) — don't re-research these:**

- ✅ **Passkey custom-domain requirement** — confirmed still required for external tenants. Domain bought; Azure DNS delegation moved into Phase 0. Also confirmed: a passkey binds to a single relying-party domain, related origins unsupported.
- ✅ **Container Apps vs. ACI** — decided in favour of Container Apps (scale-to-zero, free HTTPS ingress, free grant). ACI is out of the design.
- ✅ **Static Web Apps free tier** — includes custom domains and managed TLS, apex included; apex needs ALIAS/ANAME or CNAME flattening, which is why DNS leaves GoDaddy.
- ✅ **MSAL authority format for external tenants** — verified by pulling the live OIDC discovery document from the real tenant, not from docs. See below.
- ✅ **Workforce tenant creation** — requires a *paid* P1+; trials excluded. See the tenant table.
- ⚠️ **M365 Developer Program** — still exists and is **not** discontinued. Free renewable E5 sandbox (incl. P2) for Visual Studio Professional/Enterprise *standard* subscribers, or via ISV Success / AI Cloud Partner / Premier or Unified Support. **Steve to check personal eligibility** — if he qualifies, the workforce-tenant licensing problem costs $0.

### Verified authority + endpoints (External ID tenant)

Pulled live from `.../v2.0/.well-known/openid-configuration`:

```
MSAL authority:  https://theidentityplayground.ciamlogin.com/7e8da8a9-67bc-4d53-bfc7-fe3e13128382
authorize:       https://theidentityplayground.ciamlogin.com/{tenantId}/oauth2/v2.0/authorize
token:           https://theidentityplayground.ciamlogin.com/{tenantId}/oauth2/v2.0/token
jwks:            https://theidentityplayground.ciamlogin.com/{tenantId}/discovery/v2.0/keys
issuer:          https://7e8da8a9-67bc-4d53-bfc7-fe3e13128382.ciamlogin.com/{tenantId}/v2.0
```

**Gotcha worth a claim annotation in Module 1: the issuer and the endpoints use different hostnames.** Endpoints are on the *tenant-name* subdomain (`theidentityplayground.ciamlogin.com`); the `iss` claim uses the *tenant-GUID* subdomain (`7e8da8a9-….ciamlogin.com`). Anyone who assumes `iss` matches the authority host they configured will write a broken validator. This is exactly the kind of thing the Token Inspector exists to make visible — annotate it.

Other confirmed facts: `scopes_supported` is `openid profile email offline_access`; ID tokens are RS256; `response_modes_supported` includes `query`, `fragment`, `form_post`; region scope NA.

**Still open — confirm at build time:**

- Passkey support scope in External ID (social/OTP user registration was "on the roadmap" — recheck; if it shipped, Module 3's UI constraint text changes)
- CA capabilities in external tenants (authentication strengths were unsupported)
- External ID free MAU limit (50k as of July 2026) and SMS add-on pricing
- On-demand provisioning API surface for custom SCIM apps
- What the External ID tenant exposes of sign-in logs on the free tier (Module 6 licensing)
- ~~**Whether SWA's managed Functions API can host this backend at all**~~ **Decided 16 July 2026: it cannot.** Managed Functions are HTTP-trigger only and Module 7's lifecycle job needs a timer. Standalone Function App on consumption, SWA Free for the static site. Written up as [decision 006](docs/decisions/006-standalone-function-app.md), implemented 21 July 2026 — the standalone Function App is deployed.

