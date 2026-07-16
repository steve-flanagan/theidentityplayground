# Figure and Key — the design system

Second Fable pass, 16 July 2026, briefed on Steve's rejections: no metaphor over the
artifact, no theater, no waiting, must read technical to a peer, jwt.io as tonal anchor.

The unblocking distinction it opens with: **reference is not metaphor.** "Don't replace the
artifact with a metaphor" governs *the artifact* — the JWT stays a JWT. It doesn't mean the
design system has no lineage. The costume rule applies to the specimen, not the page it's
set on.

---

## The diagnostic — what actually separates the three looks

**Corporate training module** rations information. One idea per screen, a Next button, a
progress bar. Its defining sin is *pacing* — it decides how fast you're allowed to know
things. That's the visceral thing Steve reacted to, and it's why removing playback was the
right instinct: **the rationing is what he hates, not the illustrations.**

**Generic dark dev tool** organizes by *card*. Rounded rectangles with padding, floating in a
`gap-4` grid on slate-950. Content lives *inside containers* rather than being the substrate.
Second tell: uniform medium density — nothing is dense, nothing is empty.

**Seriously technical** does three things neither does: **density variance** (a very dense
artifact against very sparse chrome), it **typesets its numbers**, and it **shows its own
gaps**.

## The seven laws

1. **The artifact is the substrate, not the content of a card.** No cards. No shadows. No
   border radius (or 2px, once, consistently). Regions divide with hairline rules like a spec
   sheet. Full bleed — the token touches the viewport edge. A centered `max-w-5xl` column is a
   template tell; reserve max-width for prose measure (~66ch) and let artifacts run full width.
2. **Monospace means "this is literal," never "this is technical."** Reserved exclusively for
   machine strings. Never a label, never a heading, never a button. `MONO UPPERCASE
   MICRO-LABELS` on human text is cosplay and is **60% of the LLM look on its own.** This rule
   does more work than any palette change.
3. **The only saturated colour on the page is the data.** Chrome is ink-on-white with
   hairlines. Buttons have no fill. The token is the brightest thing on screen — the thesis
   expressed as a colour rule. If you can't say what a colour *means*, it isn't allowed.
   Emerald-as-accent is decoration; it fails.
4. **The biggest type on the page is a measurement.** Headings small (14px). Body small. The
   *number* — `1,412 ms`, `1,289 bytes` — is 48px+ and tabular. In a technical document the
   measurement is the loudest thing, not the label. The single most anti-template move
   available, and it costs nothing.
5. **Numbers are typeset, not printed.** `font-variant-numeric: tabular-nums` globally.
   Decimal alignment. Units suffixed at ~85% size in grey: `1,412` `ms`. Engineers notice
   within two seconds and can't tell you why they trust the page more.
6. **Interaction may add, emphasise, or connect. Never remove or replace.** No dimming, no
   fading others out, no accordions that hide, no screens that swap. This is "never replace the
   artifact with a metaphor" as an interaction rule — it kills the slideshow failure mode
   structurally rather than by discipline.
7. **The system may move. The story may not.** Live data arriving (a SCIM call, a sign-in row,
   the `exp` countdown) may animate — that's the machine, and it's the proof. Nothing narrative
   animates. Nothing animates on first paint.

## Type — three families, three epistemic registers

The register tells you *who is speaking*.

- **Mono = the machine said this, literally.** Requirements are technical not aesthetic:
  unambiguous `0/O` and `1/l/I`, good mixed-case + `+/=` rhythm (you're rendering base64, not
  code), and **ligatures off, always** — a ligature in a JWT is a lie about the bytes. That's a
  correctness decision and worth saying out loud in the sandbox. Free: **JetBrains Mono**. Paid
  connoisseur tell: **Berkeley Mono** (~$75). Avoid Geist Mono (current LLM default) and Fira
  Code (ligatures disqualifying).
- **Sans = the interface is telling you this.** Not Inter, not Geist. Free: **IBM Plex Sans**
  (industrial pedigree, coherent superfamily) or **Public Sans** (the US Web Design System face
  — literally a government technical standard). Paid: ABC Diatype, Söhne.
- **Serif = a human wrote this analysis** (margin notes, provenance prose). **IBM Plex Serif**
  keeps the superfamily. Honest risk: this register drifts editorial/museum. If it does, drop
  to sans-only and separate by size and grey value. Don't fight it.

## Colour

Ground: barely-warm off-white, ~`#FAF9F7`. Not pure white (browser default), not slate-950
(disqualified). Ink: ~`#16181C`, never `#000`.

**Light ground is the strongest single anti-slop decision available**, and the argument isn't
aesthetic: the most technical documents in this domain are ink on white. RFC 7519 is black on
white. The OIDC Core spec is black on white. jwt.io defaults light. **Nothing says "I have read
the spec" like looking like the spec.** It survives a recruiter's phone in daylight, and it's
*harder* to do well — which is itself the signal.

Three semantic hues maximum, pitched as print inks not screen accents: **oxide red** for the
header segment, **ink blue** for the payload, **muted violet** for the signature. Structural
colouring by JWT segment is a real domain convention — engineers read it as fluency, recruiters
just see structure.

Selection is **not a fourth hue — it's a ground.** A pale straw wash behind the selected span,
exactly as a highlighter works in print; the text keeps its semantic colour. Additive, never
subtractive.

## Density, grid, texture

Roughly 3–5× the information of a normal portfolio hero on first paint. A permanent margin
column (22–26ch desktop) reserved for callouts, so notes never reflow the artifact. Hairline
rules. A real baseline grid — nobody does this, and it reads as *typeset* rather than
*assembled* within a second.

**Texture comes from information, not material.** No grain, noise, glass, or gradient. The only
permitted texture is the visual noise of 1,289 characters of base64 — **the best free visual
asset the site owns. It should be big.** The current build hides it in a card.

Second texture: **hatching for spans the client cannot observe.** A labelled uncertainty
(`opaque to client — reconstructed from sign-in log, ±40 ms`) is both honest and the most
technical-looking mark you can put on a page. From engineering drawing and scientific plotting.
Free.

## Reference points

- **Scientific figure convention** — panel letters, leader lines, figure captions. A 300-year-old
  apparatus for "point at part of a dense real thing and explain it." The brief, already solved.
- **Exploded-view parts diagrams** — real object at full fidelity, numbered leaders, a key.
- **Jeppesen IFR approach plates** — dense, technical, high-stakes, instantly readable, zero
  decoration, pure wayfinding over real data. The closest existing artifact to what this site is.
- **Semiconductor datasheets** (TI, Analog Devices) — pin diagrams, timing charts, absolute
  maximum ratings. Nothing on the page that isn't specification.
- **Otl Aicher's ERCO catalogues**, Munich 1972 — where the system *is* the aesthetic.
- **Tufte** — data-ink ratio ("no ink that isn't data" is the same law as "no colour that isn't
  semantic"), and sidenote layout as the callout solution.
- **RFC plaintext typography** — the register the audience already respects.

---

## The first screen

**There is no hero and no "enter site." The landing page IS the token inspector, fully drawn,
live, at full density.**

- **Masthead**, one hairline rule, small type. Name, one line of thesis, one line of provenance:
  *"Everything below is real output from an Entra External ID tenant I run."*
- **A two-cell band**, full width, hairline-ruled — not two centred pills. `GUIDED · 7 numbered
  stops` / `SANDBOX · everything live, no numbers`. **Clicking either does not navigate.** It
  re-renders annotations on the artifact already on screen. You have already arrived; the choice
  changes annotation density, not information.
- **The artifact, full bleed.** A real specimen token as a large base64 wall in three segment
  colours, decoded JSON linked beside it, the 16-claim table at full density below or right.
  Hairlines, no cards. Labelled: *"Specimen. Issued to nobody. Yours will differ in 7 places."*
- **One huge number.** `1,289 bytes · 16 claims`. Tabular, 48px+.
- **Sign-in lives inside the artifact frame**, not a nav bar: *"Get yours. It replaces this one
  in place."*
- Hairline-ruled index of other modules at the foot. A list, not a bento grid.

Nothing animates on arrival. Legible at t=0. On a phone, columns stack, the base64 wall stays
big, the margin column becomes a caption block below the figure.

---

## Interaction — brushing and linking

The mechanic has a real name: **brushing and linking**, from dynamic statistical graphics
(Becker/Cleveland, late 1980s). Not invented — canonical. Every serious analysis tool descends
from it. Worth naming in the sandbox.

### The raw JWT

Three views on screen simultaneously and permanently: **base64 wall**, **decoded JSON**,
**claims table**. One dataset, three renderings.

- **Hover or tap any claim row** → the exact character span *in the raw base64 that encodes that
  claim* takes the straw ground; the JSON line takes it; the table row takes it. Three
  highlights, one action, **0ms, no transition**.
- Computing that span is real work — base64 packs 3 payload bytes into 4 characters, so a JSON
  substring maps to a genuine character range with a character or two of bleed. Engineers *will*
  check it. Best "he actually understands the encoding" flex on the site, ~30 lines.
- **Callouts are margin notes with hairline elbow leaders**, vertically aligned to the span. Not
  floating tooltips with shadows. **Typeset, not popped.** They **stay** on click. Several can
  stay. Because the margin column is permanent, nothing reflows and **the artifact is never
  occluded** — the law that keeps it dense instead of a slideshow.
- **Zoom is hierarchical, not optical.** Clicking a claim expands in place (≤120ms, ease-out, no
  spring) into the provenance stack:

```
name   Steven Flanagan
       ORIGIN    User object → displayName
       EMITTED   Optional claim · App registration → Token configuration
       SPEC      OIDC Core §5.1
       IF OFF    This row would not exist.
```

`IF OFF: this row would not exist.` is the whole brief in one line — the recruiter reads English,
the engineer reads a config assertion.

- **Annotate the absence.** The `amr` gap is the highest-credibility row on the page:

```
amr    —  (absent)
       WHY   Not issued on this flow by External ID.
       COST  Module 3 reads the method from sign-in logs instead.
```

**An artifact that annotates its own gaps is more credible than a complete one. Nobody's
portfolio does this.**

- **Optical zoom exists only on mobile**, where it's the right answer: tap a segment, it fills
  the screen.

### The 14-event timeline

Fully drawn on arrival as a **figure**, never a playback. Four lanes (browser / IdP / token
service / policy), 14 marks at true positions from real timestamps, duration set large:
`1,412 ms`. A numbered key beside it as a real table — number, t+ms, actor, event, payload.
Figure and key brush each other.

**The stretch returns without theater: zoom is a control the user drags.** Select a span on the
axis, it rescales. Instantly. The insight survives exactly; the waiting is gone. And it's *more*
impressive to a peer — an animation is decoration, a zoomable time axis over real timestamps is a
tool. **You control time; time does not control you.** All 14 marks are visible at full extent, so
zoom is an enhancement, never a gate.

Unobservable spans get the hatch and the honest label. Mobile rotates the axis vertical — time
flows down, lanes become columns, marks become rows. That's a log, native to a phone. Same
information, not a reduction.

**The two artifacts brush each other.** Click `name` in the token → mark 9 lights on the timeline
→ margin note: *"entered here, from the directory read."* Per-claim provenance on a time axis,
as the spine rather than a feature.

---

## Can a recruiter have an "oh" without theater?

**Yes — but the "oh" changes character, and he should know exactly what he traded.**

Theater manufactures *delight* by controlling when you look: withhold, then pay. Remove it and
you lose timing control, which means **you lose the guaranteed moment.** Everyone who sits
through theater gets it. Only people who *click* get a manipulation-based moment. Some recruiters
won't click. That cost is real and not small.

Three sources of "oh" survive because none are staged:

1. **Recognition of self.** Your own name inside a wall of gibberish. Static fact, zero wait.
2. **A number.** `1,412 ms · 14 events · 4 systems`. A well-set number is a punchline.
3. **Liveness.** Your own sign-in appearing in the admin dashboard within seconds. Autonomous
   motion — the machine, not a story.

And one *stronger* than theater: **direct manipulation.** People remember what they did, not what
they watched. A recruiter who drags the timeline open and finds fourteen events inside a flicker
has *done* something. Rarer than theater's moment, better when it lands.

**The design consequence, which is the actual answer:** if nothing plays, **the reveal must be the
default state, not the reward for interacting.** Their name is *already* highlighted inside the
base64 at first paint, with a leader to a margin note — *"Those 11 characters are your name. Your
browser has been carrying this since you clicked Sign in."* The `exp` countdown is *already*
ticking: `51:04 until this expires`. **Theater withholds and then pays; remove theater and you
must pay on arrival.** Clicking only ever gets you *more*.

### The unreassuring part — two real losses

- **Amplitude.** Nothing here makes someone forward the link out of delight. The passport MRZ
  decode would have. He is trading a delight spike for credibility density.
- **Teaching.** Theater is how you teach someone who won't read. He has removed theater and kept
  prose, and prose is opt-in, and most recruiters won't. Guided-as-reading-order does not teach a
  non-technical person what a claim is; it gives them a path they won't walk. **Design for a
  recruiter who reads exactly one line of text and one number.** Those two things must carry the
  entire visit alone.

The reframe: the recruiter's "oh" was always going to be *impression*, never *comprehension*. The
email is "I built this since we last spoke." The link's job is to **survive twenty seconds of
skepticism**, not to teach. Density, their own name, and a real number do that. Theater was never
necessary for it — and the engineer, who actually decides the hire, would have discounted the
theater anyway.

If the site later reads as admired-but-not-forwarded, the missing quantity is amplitude, and *that*
is when the stretch returns — as a control, not a movie.

---

## What we missed — observatory vs control panel

**All three territories made the site an observatory. None made it a control panel.**

Port of Entry, Strip Chart, and the Museum all answer "here is what happened." None answers "here
is what *I* did to make it happen." **A recording proves he can watch. A diff proves he can cause.
Engineers are hired for what they can change.**

The missing spine is **the diff.** Every module on the list is secretly a comparison already:
customer vs guest vs employee, password vs passkey, policy on vs off, claim present vs absent. Put
**two real tokens side by side with the differences marked**, and:

- It's a native technical grammar — engineers read diffs daily, and it's jwt.io-adjacent, his own
  tonal anchor.
- **It's static and instantly legible. A diff *cannot* play.** Structurally incapable of the
  failure mode he rejected.
- It **subsumes per-claim provenance** — provenance is a diff against a counterfactual. `IF OFF:
  this row would not exist` *is* a diff.
- The recruiter moment needs no theater: two walls of gibberish, seven lines glowing. *"These two
  people signed in to the same app. This is every difference. I control all of it."*
- Mobile is solved by a convention that exists for exactly this reason: unified diff view.
- Honesty is buildable: pre-capture real tokens from several real app registrations, label plainly
  that the toggle selects among real captured artifacts rather than mutating live config, and offer
  a live re-auth path for anyone who wants to prove it. **Saying which is which is itself the flex.**

**And a harder thing he should hear.** "The ontology survives" may be optimistic. Once you remove
the pen, the paper, the playback, and the stretch, what's left of Strip Chart is *a timeline
module*. That's a component, not an organizing idea. The organizing idea has to come from
somewhere, and it can no longer come from metaphor or from time-as-theater. **Causality is the
candidate: config → artifact.** Time becomes one axis; configuration becomes the other.

Add rather than swap — they're compatible, and the visual grammar is identical (linked views,
brushing, margin callouts, hairlines), so it costs almost nothing to fold in. But being straight:
**if I were choosing the spine today, I'd choose causation over observation.** The current thesis —
*"identity work is invisible; this makes it visible"* — is passive. The better job-hunt thesis is
*"identity work is invisible, and it's a machine with knobs; here are the knobs, and here's what
each one just did to you."*

### Three smaller things, not territories

- **Failure.** Every module shows success. Real IAM is failure diagnosis. A failed sign-in with the
  real `AADSTS` code and the token that was *not* issued is the most technical thing the site could
  contain. Zero recruiter value, enormous engineer value.
- **The countdown.** `exp` is the one claim a normal person understands. A live countdown on their
  own token is an "oh" for free, requires no theater, and is real.
- **Why the token is useless to you.** "Here it is in full; here's why you can't do anything with
  it; here's what would happen if signature validation were skipped." Engineer catnip, and it
  preempts the "isn't this leaking?" question a security-minded reader has within ten seconds of
  seeing a real JWT on a public page.
