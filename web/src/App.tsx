import { useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { SiteNav } from './components/SiteNav'
import { TokenInspector } from './components/TokenInspector'
import { JourneyTimeline } from './components/JourneyTimeline'
import { SignInPanel } from './components/SignInPanel'
import { buildSampleToken, buildMemberSampleToken } from './lib/sampleToken'
import { MEMBER_FLOWS, GUEST_FLOWS } from './lib/journey'
import { readGuestToken, clearGuestToken } from './guest/handback'
import {
  accountCreatedAtMs,
  readLastFlow,
  settleLastFlow,
  type FlowMatch,
} from './lib/lastFlow'

// Phase 1. Sign in and the inspector reads your real ID token; otherwise it
// falls back to a clearly-labelled sample so the page still demonstrates
// something to a visitor who doesn't want an account.

/**
 * One card per module that lives elsewhere. Three of these replaced two inline
 * sections and a one-off block, so it is worth being a component rather than
 * three copies that drift.
 *
 * None of them is gated on being signed in. That is deliberate and it is the
 * difference between these and the /app2 link further up the page: /app2 proves
 * nothing to a signed-out visitor because they would just be sent to Entra for
 * credentials, whereas every one of these works with no account at all.
 */
function ModuleLink({
  href,
  path,
  title,
  children,
}: {
  href: string
  path: string
  title: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className="block rounded-xl border border-slate-800 bg-slate-900/40 p-5 transition hover:border-slate-700 hover:bg-slate-900/70"
    >
      <h3 className="text-base font-medium text-slate-200">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{children}</p>
      <p className="mt-3 font-mono text-sm text-emerald-300">
        {path} <span className="text-slate-500">· no account needed</span>
      </p>
    </a>
  )
}

function App() {
  const { accounts } = useMsal()

  // Built once per mount so the validity window reads relative to now.
  const sampleToken = useMemo(() => buildSampleToken(), [])

  // MSAL caches the raw ID token on the account it hands back. No extra call
  // needed — it's the token the visitor was just issued.
  const account = accounts[0] ?? null
  const realIdToken = account?.idToken ?? null

  /**
   * Sign-up or sign-in, from the account creation time the token carries.
   *
   * ── THE ORDERING PROBLEM, AND WHY THE ANSWER ARRIVES AS A PROP ────────────
   *
   * The timeline reads which flow happened once, in a useState initialiser, on
   * mount. That runs during its render, before any effect anywhere. So even
   * though this costs nothing but a base64 decode, it still lands after the
   * component has decided what it is showing, and it has to reach a component
   * that has already made up its mind.
   *
   * Same shape as localSignOutCount below: hold it here, pass it down, let the
   * timeline notice it changed. No store, no context, no event.
   */
  const [resolvedFlow, setResolvedFlow] = useState<FlowMatch>(null)

  useEffect(() => {
    // The REAL token, never `realIdToken ?? sampleToken` — which is what the JSX
    // below hands the inspector and the timeline for display. The sample's
    // createddatetime is invented, dated months before its own iat, so feeding
    // it to resolveAmbiguous would badge a sign-in that nobody performed, off a
    // number nobody measured. Pinned by App.test.tsx.
    if (!realIdToken) return
    // Only the pair we cannot tell apart. The deterministic branches already
    // know what they are and must not be second-guessed.
    if (readLastFlow()?.kind !== 'ambiguous') return

    const settled = settleLastFlow(accountCreatedAtMs(realIdToken), realIdToken)
    // Still ambiguous means the claim was absent or unreadable. Leave the page
    // exactly as it is rather than re-rendering it to say the same thing.
    if (settled?.kind === 'matched') setResolvedFlow(settled)
  }, [realIdToken])

  /**
   * Signing out of this app only makes no request and never navigates, so the
   * sessionStorage marker that carries every other flow across its redirect has
   * nothing to carry and nothing to come back and read. The panel raises it
   * here instead and the timeline moves onto the sign-out flow in place.
   *
   * A counter, not a flag: the visitor can click away to another flow and sign
   * out again, and the second click has to move the timeline as surely as the
   * first. A flag would already be true and nothing would happen. It is never
   * displayed and it is not a duration.
   */
  const [localSignOutCount, setLocalSignOutCount] = useState(0)

  /**
   * Module 2's member simulation. A visitor can never really be a workforce
   * member, so "Sign in as Member" flips this on and App swaps three surfaces
   * onto the member sample: the inspector token, the timeline's flows, and the
   * account-types map. Client-side only, no MSAL and no network. Null is
   * signed-out or the real customer, exactly as before.
   */
  const [activeSim, setActiveSim] = useState<'member' | null>(null)
  // A real sign-in always wins over the sample. The button that sets this is
  // hidden once you are signed in (see SignInPanel), and this is the belt to that
  // suspenders: even if activeSim were somehow still set, a real token overrides
  // it, so the two identities can never fight over the three surfaces.
  const simMember = activeSim === 'member' && !realIdToken
  // Built once, like the customer sample beside it.
  const memberToken = useMemo(() => buildMemberSampleToken(), [])

  /**
   * Guest mode: the real token a /guest sign-in handed back through
   * sessionStorage (guest/handback.ts), read once on mount. A live guest sign-in
   * drives the inspector and Module 2 (the two surfaces this was scoped to) and
   * outranks the member sample — but NOT a real CIAM customer session, which
   * wins. /guest scopes its clearCache to the workforce account, so a customer
   * signed in on `/` survives a guest sign-in; the `!realIdToken` guard keeps
   * guest mode from masking that live session, while guest still wins the normal
   * case (a visitor who was never signed in, where realIdToken is null).
   */
  const [guestToken, setGuestToken] = useState(() => readGuestToken())
  const guestMode = Boolean(guestToken) && !realIdToken
  const exitGuest = () => {
    clearGuestToken()
    setGuestToken(null)
  }

  // What the inspector shows, in precedence order: a live guest, then the member
  // sample, then the real customer token or the customer sample. `live` is true
  // only for a real token, so the sample keeps its "not your real token" framing.
  const inspectorToken = guestMode
    ? guestToken!
    : simMember
      ? memberToken
      : (realIdToken ?? sampleToken)
  const inspectorLabel = guestMode
    ? 'Your guest ID token'
    : simMember
      ? 'Member sample token'
      : realIdToken
        ? 'Your ID token'
        : 'Sample ID token'
  const inspectorLive = guestMode ? true : simMember ? false : Boolean(realIdToken)

  return (
    // No max-width. There was one — 112rem, 1792px — and on a full-screen
    // window wider than that it stopped the page dead in the middle of the
    // monitor and left the rest empty. px-8 is the indent and stays 32px at
    // every width; the fix is the cap coming off, not the gutters growing.
    //
    // Nothing runs away as a result. The reading columns cap themselves at
    // max-w-3xl (header, footer, the section blurbs), and the claims
    // panel is a fixed 27rem in the grid below. The only thing that grows is
    // the timeline's 1fr column, which is the one that wants the room.
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="px-8 pt-10 pb-20">
        <SiteNav current="/" />
        <header className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Token inspector · sign-in timeline
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            The Identity Playground
          </h1>
          {/* Three rewrites are baked in here, all from real feedback.
              0. The second sentence used to promise "the same person as a
                 customer, an employee and a B2B guest". That module moved to
                 /accounts, and a card two screens down now says the same thing.
                 A header promising what the page no longer shows, duplicated by
                 a link that does, is two problems rather than one.
              1. The version before last opened "sign in for real", which put the
                 one thing most visitors will not do in front of the one thing
                 they will.
              2. The version after that opened "Identity work is invisible in
                 production. This site makes it visible:" — a thesis statement,
                 then a colon list. A reader on r/entra called the site "too AI",
                 and that construction was the loudest reason why.
              What replaced it says what is on the page and stops. No thesis, no
              setup-and-payoff, and it names the two modules concretely because
              the same reader could not tell what the site was meant to prove. */}
          <p className="mt-6 text-lg leading-relaxed text-slate-400">
            A real Entra ID token, claim by claim, and every request that produced it. No
            account needed.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-slate-400">
            By <span className="text-slate-200">Steven Flanagan</span>. Every module links
            to the tenant config and source that produced it.
          </p>
        </header>

        {/* Claims right, everything else left. The claims panel is a sticky,
            internally-scrolling reference column pinned to the right: top-6,
            capped at the viewport, and it scrolls inside itself. It stays put
            while the left column scrolls past it. The LEFT column holds the
            timeline AND Module 2, so the pinned claims stay in view as you scroll
            from the token flow down into the account-types map. Claims are first
            in the DOM, placed right by the grid, so a phone shows the payoff first
            and then stacks the left column. Below lg the grid is one stacked
            column and nothing is pinned. */}
        <div className="mt-12 grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_27rem]">
          {/* ── ORDER IS DIFFERENT ON A PHONE, AND THAT IS THE POINT ──────────
              The grid already puts this section first in the DOM so a phone sees
              the claims before the timeline. That was only half the job: INSIDE
              the section the sign-in panel sat above the inspector, and on a
              phone that panel is a full screenful of configuration (sample
              identities, the SSO checkbox, three paragraphs on prompt=login).

              Measured at 390x844: two entire screenfuls before the first claim,
              on a 10.6-screenful page. A reader on r/entra said it read as a lot
              of text and they could not tell what it was meant to prove. Both are
              the same defect: the proof was below the fold.

              flex + order, so mobile reads heading → token → sign-in, while lg
              keeps the original heading → sign-in → token. Nothing moves in the
              DOM, so the reading order for a screen reader follows the visual
              one at each width. gap-4 replaces the per-child mb-4s, which would
              otherwise land on the wrong side of a reordered child. */}
          <section
            aria-labelledby="inspector"
            className="flex flex-col gap-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:overflow-x-hidden"
          >
            <div className="order-1">
              <h2 id="inspector" className="text-sm font-medium uppercase tracking-widest text-slate-500">
                {guestMode
                  ? 'Your guest claims'
                  : simMember
                    ? 'Member’s claims (sample)'
                    : realIdToken
                      ? 'Your claims'
                      : 'The claims you’d get'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {guestMode
                  ? 'The real token from your guest sign-in, every claim annotated. Note the workforce tenant, your external home realm, and the idp claim that gives it away.'
                  : simMember
                    ? 'A workforce member’s captured token, shown as a sample. Every claim annotated, with the member’s values.'
                    : realIdToken
                      ? 'The real token you were just issued, every claim annotated: what it is, why it’s in your token, and which tenant configuration produced it.'
                      : 'A sample, until you sign in. Then this reads your own real token: same claims, your values.'}
              </p>
            </div>

            <div className="order-3 lg:order-2">
              <SignInPanel
                onLocalSignOut={() => setLocalSignOutCount((n) => n + 1)}
                onSimulateMember={() => setActiveSim('member')}
                simActive={simMember}
                onExitSim={() => setActiveSim(null)}
                guestActive={guestMode}
                onExitGuest={exitGuest}
              />
            </div>

            <div className="order-2 lg:order-3">
              <TokenInspector
                token={inspectorToken}
                label={inspectorLabel}
                live={inspectorLive}
              />
            </div>

            {/* ── The way to /app2, which was reachable only by typing the URL ──
                Placed under the token because that is where a reader who has
                just finished reading their claims is, and the next thing /app2
                does is hand them a second set.

                GATED ON THE TOKEN, not merely explained. A signed-out visitor
                who follows this gets sent to Entra for credentials, and App2
                says so itself: with no session to reuse, its own copy drops to
                "the round trip does not prove SSO … press the button again".
                The demonstration is that no prompt appears, so offering it in
                the one state where a prompt does appear spends the page's best
                argument on the visitor least able to check it. `realIdToken`
                already gates copy elsewhere in this file, so the condition
                costs nothing new.

                A plain sentence, deliberately: this is a reference the reader
                either wants or doesn't, and the same underline treatment /app2
                uses for its link back here. */}
            {realIdToken && (
              <p className="order-4 text-sm leading-relaxed text-slate-400">
                <a
                  href="/app2"
                  className="font-mono text-slate-300 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
                >
                  /app2
                </a>{' '}
                is a second app registration in this tenant: same session, its own token.
              </p>
            )}
          </section>

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <section aria-labelledby="journey">
            <div className="mb-5">
              <h2 id="journey" className="text-sm font-medium uppercase tracking-widest text-slate-500">
                How those claims got there
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
                Every request in a real sign-in, measured. The entire flow stays on the overview bar;
                below it each step sits on its own axis. Click slices for details and code examples
                where applicable.
              </p>
            </div>

            <p className="mb-4 max-w-3xl rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200/70">
              <span className="font-medium text-emerald-300">Measured, not estimated.</span> Every
              millisecond comes from a real capture of a real flow against this tenant. Server time
              per request, and the phases inside it.
            </p>

            {/* Kept OUT of the "measured" box on purpose. That box is a standing
                claim about the data's provenance; this is a temporary state note
                that stops applying the moment someone signs in. Folding a
                transient into a permanent statement made both read as hedging. */}
            {!realIdToken && !simMember && !guestMode && (
              <p className="mb-4 max-w-3xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/70">
                <span className="font-medium text-amber-300">Recorded sample flows.</span> Sign in
                and the one you actually performed gets called out.
              </p>
            )}

            {simMember && (
              <p className="mb-4 max-w-3xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/70">
                <span className="font-medium text-amber-300">Member sample.</span> A real workforce
                member’s captured sign-in, replayed. Switch tabs to compare SSO against a full sign-in.
              </p>
            )}

            {guestMode && (
              <p className="mb-4 max-w-3xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/70">
                <span className="font-medium text-amber-300">Guest sign-up, recorded.</span> The token
                above is your own, live. This flow is a real capture of the self-service B2B sign-up
                that made it, measured request by request.
              </p>
            )}

            {/* One timeline, the identity is the variable. The member sim is a
                separate mount (its own key) so it opens fresh on the member flows
                with no customer lastFlow, badge or deep link carried across. */}
            {guestMode ? (
              <JourneyTimeline
                key="guest"
                token={guestToken!}
                tokenLabel="Your guest ID token"
                flows={GUEST_FLOWS}
                defaultFlow="guest-signup"
                simulated
              />
            ) : simMember ? (
              <JourneyTimeline
                key="sim-member"
                token={memberToken}
                tokenLabel="Member sample token"
                flows={MEMBER_FLOWS}
                defaultFlow="member-signin"
                simulated
              />
            ) : (
              <JourneyTimeline
                key="customer"
                token={realIdToken ?? sampleToken}
                tokenLabel={realIdToken ? 'Your ID token' : 'Sample ID token'}
                localSignOutCount={localSignOutCount}
                resolvedFlow={resolvedFlow}
              />
            )}
          </section>

          </div>
        </div>

        {/* ── THE OTHER MODULES, AS LINKS ────────────────────────────────────
            Module 2 and Module 7 used to sit stacked in the left column above,
            and the homepage ran to nine screenfuls on a phone. An old colleague
            called the site "a bit crowded/unclear for certain things" and he was
            describing this.

            Each is a separate product with its own subject, and none of them
            needs the sign-in machinery this page is built around, so a page each
            is the honest shape rather than a tidying trick. What is left here is
            Module 1: your token, and the requests that produced it.

            The account map keeps the one thing it would otherwise have lost. On
            the homepage it knew which identity you were running and lit that row;
            the link carries it in `as` so the map still opens on you. */}
        <section className="mt-16 max-w-3xl" aria-labelledby="more">
          <h2 id="more" className="text-sm font-medium uppercase tracking-widest text-slate-500">
            The rest of it
          </h2>

          <div className="mt-6 space-y-3">
            <ModuleLink
              href={`/accounts${guestMode ? '?as=guest' : simMember ? '?as=member' : ''}`}
              path="/accounts"
              title="One person, three directory objects"
            >
              A customer, an employee and a business guest. Pick one and its reach lights up across
              the tenants, their subscriptions and the app.
            </ModuleLink>

            <ModuleLink
              href="/scim"
              path="/scim"
              title="Hire someone, and watch a SaaS app find out"
            >
              A demo employee is created in a real Entra tenant and provisioned into an app over
              SCIM 2.0. Every request Entra makes is shown as it arrives, including the one that
              does not follow the specification Microsoft asks you to implement.
            </ModuleLink>

            <ModuleLink
              href="/cleanup"
              path="/cleanup"
              title="Every demo account deletes itself"
            >
              The job that keeps the promise the rest of this site keeps making, and its real run
              history.
            </ModuleLink>
          </div>
        </section>

        {/* ── THE ROADMAP IS GONE, ON PURPOSE (Steve, 28 July 2026) ──────────
            It listed seven modules, four of them marked "planned". The spec's
            framing was "the site is never 'unfinished,' just growing" (§5), but
            the rendered effect on someone skimming for forty seconds was a
            majority-grey list of IOUs, and unfinished is the one thing a
            portfolio artifact cannot afford to read as.

            Three live modules presented as a finished set of demonstrations is
            a stronger artifact than the same three with four promises under
            them. What ships next is decided in notes/next-build.md, which is
            where a roadmap belongs. Not on the homepage. */}

        <footer className="mt-16 max-w-3xl border-t border-slate-800 pt-6">
          <p className="text-sm text-slate-600">
            Demo tenants only. No real accounts, no real data. Every account created here
            self-destructs.
          </p>
        </footer>
      </div>
    </main>
  )
}

export default App
