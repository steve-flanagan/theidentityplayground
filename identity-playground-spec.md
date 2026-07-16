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
| **External ID tenant (new)** | Customer/CIAM sign-ups, the main public entry point | Free to 50,000 MAU |
| **Demo workforce tenant (new)** | Fake "employee" accounts, B2B guest scenarios, SCIM provisioning source, sign-in log dashboard | Free tier + one Entra ID P1 license (~$6/mo, or 30-day P2 trial to start) |
| **Steve's existing tenant** | NOT used. Never expose your real tenant to a public demo. | — |

Document the tenant-separation rationale in the README — it demonstrates correct security architecture thinking.

### Hosting (all on existing Azure pay-as-you-go subscription)

| Component | Service | Tier | Est. cost |
|---|---|---|---|
| Front-end (SPA) | Azure Static Web Apps | Free | $0 |
| Backend API | Azure Functions (consumption) | Free grant: 1M executions/mo | ~$0 |
| SCIM mock app (module 5) | Azure Container Instances | Small (0.5 vCPU / 1 GB) | ~$3–8/mo always-on; less if start/stopped on schedule |
| Secrets | Azure Key Vault | Standard | <$1/mo |
| State (event feed, demo data) | Azure Table Storage or Cosmos DB free tier | — | ~$0 |
| **Total** | | | **~$5–15/mo** |

Reuse the Cost Management budget-alert pattern from the pipeline project (tiered alerts at 50/67/100%).

### Repo layout (single monorepo)

```
identity-playground/
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
- **Graph access:** Backend uses a Managed Identity or app registration with client credentials — never expose Graph tokens to the browser. Application permissions kept to the minimum per module (document each permission and why — that's an IAM skill on display).
- **Automation/ops scripts:** PowerShell + Microsoft Graph PowerShell SDK (your home turf — these scripts are portfolio pieces themselves).
- **SCIM mock:** Small Node.js (Express) app implementing SCIM 2.0 `/Users` endpoints, containerized, deployed to ACI.

---

## 3. Modules

Ordered by build sequence, not homepage order. Each lists: experience, what it proves, implementation, Entra config, licensing, gotchas.

---

### Module 1 — Token Inspector (build first; everything feeds it)

**Visitor experience:** After any sign-in anywhere on the site, a panel decodes their own ID token and access token in the browser. Each claim is annotated: what it is, why it's present, which tenant config produced it. Hover a claim → explanation. Toggle between "raw JWT" and "annotated" views.

**Proves:** Deep understanding of tokens, claims, OIDC — the thing interviewers actually probe.

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

**Gotchas (verified July 2026 — recheck at build time):**
- Passkeys in External ID: only email+password / username+password local accounts can register one; MFA required before registration; NOT available for social-IdP or email-OTP users. Display this constraint in the UI — knowing platform limitations is expert signal.
- Passkey support in external tenants may require a custom URL domain (CNAME + DNS verification). Budget a day; a cheap domain (~$10–15/yr) also makes the whole site look professional.
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
- Registered as a **non-gallery enterprise app** in the demo workforce tenant with automatic provisioning configured (tenant URL = ACI public endpoint, secret token from Key Vault).
- Event feed: mock app writes every SCIM request it receives to Table Storage; front-end polls or uses SignalR (Functions binding) for the live feed.
- "Hire" button → Function calls Graph to create user + group membership. Provisioning then happens on Entra's cycle.

**Licensing:** **Requires Entra ID P1 in the demo workforce tenant** (provisioning to custom SCIM apps is not on the free tier). One P1 license ≈ $6/month, or start on the free 30-day P2 trial.

**Gotchas:**
- Entra's provisioning cycle runs every ~20–40 minutes. For the live demo, use **on-demand provisioning** (Graph: `synchronization/jobs/{id}/provisionOnDemand`, or the portal's "Provision on demand") triggered by your Function so the visitor sees results in seconds, not half an hour. This is the module's key design decision — document it.
- Append `?aadOptscim062020` to the tenant URL for standards-compliant PATCH behavior if you hit PATCH issues.
- ACI endpoint must be HTTPS — put it behind a small reverse proxy with TLS or use Azure Container Apps (which gives you HTTPS ingress free; consider it over ACI, may be cheaper at this scale).

---

### Module 6 — The Admin's View

**Visitor experience:** A read-only "admin dashboard" showing recent sign-in activity in the demo tenants — and the visitor's **own sign-in appears in it** within seconds of them using any other module. Shows: app, identity type, auth method, MFA result, CA policies applied. Sanitized (no IPs/emails beyond the visitor's own session).

**Proves:** Graph API automation, sign-in log analysis, monitoring mindset.

**Implementation:**
- Backend Function polls Graph `auditLogs/signIns` (both tenants) every ~30s while the site is active; caches sanitized entries in Table Storage; front-end displays feed.
- Match "your sign-in" by correlating the visitor's `oid`/session with log entries.

**Licensing:** Reading sign-in logs via Graph in a workforce tenant requires P1 (same license as Module 5). Verify what the External ID tenant exposes on the free tier at build time.

**Gotchas:** Sign-in log entries can lag 1–5 minutes. Set the UI expectation ("your sign-in will appear within a few minutes") rather than promising real-time. Privacy: display only the current visitor's identifying details to that visitor; mask everyone else's.

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
2. **Rate limiting** on all backend Functions (per-IP throttling; Azure API Management consumption tier or in-code).
3. **No SMS anywhere** (cost abuse vector).
4. **Minimal Graph permissions** per Function, documented in `docs/` — the permission-scoping writeup is itself portfolio material.
5. **Demo workforce tenant hardening:** restrict default user permissions, no admin roles on demo accounts, block legacy auth, guests restricted to the demo app.
6. **Budget alerts** from day one; hard cap decision documented (what shuts off first if costs spike — likely the ACI).
7. **Secrets in Key Vault only**; Functions use Managed Identity to read them. No secrets in repo, ever (add gitleaks or GitHub secret scanning).

---

## 5. Build phases

| Phase | Ships | Definition of done |
|---|---|---|
| **0** | Tenants + scaffolding | External ID tenant created; demo workforce tenant created; P2 trial or P1 activated; repo initialized; Static Web App deployed with "hello world" SPA; budget alerts live |
| **1** | Module 1 + basic CIAM sign-in | Visitor can sign up/sign in (email + Google) and inspect their own annotated token. **This alone is resume-worthy — publish it.** |
| **2** | Module 7 + Module 2 | Lifecycle cleanup running; three doors live with comparison table |
| **3** | Module 3 | Auth arena incl. passkey (custom domain done here) |
| **4** | Module 6 | Admin's view dashboard |
| **5** | Module 4 | CA live demo (builds on 3 + 6 plumbing) |
| **6** | Module 5 | SCIM mock + live provisioning feed |
| **7** | Polish | Bicep templates in `infra/`, architecture diagram, per-module writeups |

Each phase is independently shippable. The site is never "unfinished," just growing — put a roadmap on the homepage.

---

## 6. Claude Code starter prompt (Phase 0 → 1)

Paste this into Claude Code from the repo root:

```
I'm building "Identity Playground" — a public portfolio site demonstrating
Microsoft Entra IAM scenarios interactively. Full spec is in
identity-playground-spec.md at the repo root — read it completely before
doing anything.

About me: I'm an experienced IAM engineer (Entra, Graph API, PowerShell)
but NEW to web development, React, git, and this toolchain. Explain dev
concepts briefly in plain language as we go. Do not explain IAM concepts
to me. Work phase by phase; verify each step works before moving on, and
tell me exactly what to check.

Current state: I have an Azure pay-as-you-go subscription. I've created
[UPDATE: which tenants exist yet]. Nothing else exists.

Today we're doing Phase 0 and starting Phase 1 (see spec section 5):
1. Walk me through creating the External ID tenant and demo workforce
   tenant (I'll do portal steps; give me exact clicks and tell me what
   to record — tenant IDs, domains).
2. Scaffold the monorepo per spec section 2: Vite React SPA in web/,
   Azure Functions project in api/, docs/ structure. Initialize git,
   sensible .gitignore, README stub.
3. Set up the SPA with MSAL (@azure/msal-react) configured for the
   External ID tenant — sign-up/sign-in with email, sign-out, and
   display of the raw ID token.
4. Deploy to Azure Static Web Apps free tier and verify the live sign-in
   flow works end to end.

Constraints from the spec that apply today: no secrets in the repo,
minimal Graph permissions, everything stays in free tiers for Phase 0-1.

Before writing code, confirm current versions/docs for: MSAL.js with
External ID external tenants (authority URL format changed from B2C —
verify current format), and Static Web Apps deployment via GitHub
Actions. Look these up rather than assuming.
```

---

## 7. Verify before building (things that change)

At build time, have Claude Code or a search confirm current state of:

- Passkey support scope in External ID (social/OTP user support was "on the roadmap" as of mid-2026; custom-domain requirement may have changed)
- CA capabilities in external tenants (authentication strengths were unsupported)
- Whether Microsoft 365 Developer Program sandbox tenants are available to you (was restricted to partners/Visual Studio subscribers — if available, it changes the licensing math)
- External ID free MAU limit (50k as of July 2026) and SMS add-on pricing
- MSAL.js authority/configuration format for external tenants
- On-demand provisioning API surface for custom SCIM apps
- Azure Container Apps vs. ACI pricing for the SCIM mock

---

## 8. Making it visible (distribution plan)

The site does not market itself. The plan:

1. **Resume:** One project block, 3 bullets max, with the URL prominent. Lead with what a visitor can DO ("live public demo — sign in and inspect your own token"), not the tech list.
2. **LinkedIn:** One post per shipped phase (7 posts over the build). Short, one screenshot/GIF, one insight learned. Tag #EntraID #IAM. The Entra community on LinkedIn is small and active — module 5 (SCIM live feed) is the most shareable.
3. **README as landing page:** Assume more people see the GitHub README than the site. Architecture diagram at top, GIF of the token inspector, link to live site above the fold.
4. **Interviews:** The real payoff. "Can I share my screen?" → live demo beats every behavioral answer. Rehearse a 3-minute walkthrough.
5. **Per-module writeups** in docs/ double as blog posts (dev.to or LinkedIn articles) — each one is a search-indexable artifact with your name on it.
