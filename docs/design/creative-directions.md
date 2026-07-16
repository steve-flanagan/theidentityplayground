# Creative directions — three territories

Generated 16 July 2026 by Fable, briefed on the two audiences (non-technical
recruiters; technical hiring managers), the guided/sandbox split, and the hard
constraint that the current look — slate-950, emerald accents, rounded cards,
mono uppercase labels — is the default LLM aesthetic and is disqualified.

The three differ at the level of ontology, not palette. In the first the site is
a **place** and your token is a **document**. In the second it's an **instrument**
and your sign-in is a **recording**. In the third it's an **exhibition** and your
token is an **object**.

---

## 1. Port of Entry

**Conceit:** Signing in is crossing a border, and this is the one checkpoint that
shows you its own paperwork. OIDC borrowed its nouns from travel documents —
issuer, subject, audience, claims — so render modern auth in the print language
of the documents it replaced.

**First 10 seconds:** Paper-white ground, manila accents. A Solari split-flap
strip ticks over as real anonymised sign-ins happen: `VISITOR · EMAIL OTP ·
ENTERED 00:41 AGO`. Two overhead wayfinding signs: "GUIDED — follow the marked
route" / "SANDBOX — all areas". A boarding-pass card: "Sign in to receive your
documents." Only the flap board moves.

**Guided vs sandbox:** Guided is the escorted route — numbered checkpoints
(present credentials → inspection → stamp → entry), one artifact per screen.
Sandbox is airside access: a terminal map, every desk open, lanes comparable
side by side, back-office door unlocked. Sign-in types map to Nationals /
Visitors / Crew lanes. Conditional access is secondary inspection with the
rulebook open. SCIM is the work-permit desk. Demo accounts are single-entry
visas, stamped VOID after an hour.

**The recruiter moment:** Their token renders as a passport data page — name and
email in printed fields, and below, the *actual raw JWT* set in OCR-B as a
machine-readable zone. "The printed page and the machine zone say the same
thing. One is for you. One is for the machine. Tap the machine zone." A span of
gibberish lights and slides up into the NAME field — their own name emerging
from the noise. Then stamps land: entry (issuer), visa (audience), expiry.
Computable for real: base64 maps 3 payload bytes to 4 characters, so the
highlighted span genuinely is where their name lives.

**Visual language:** Paper whites, manila, ink navy, two stamp inks (oxblood,
ink blue). Guilloché banknote engraving as dividers at 5% contrast. Humanist
wayfinding grotesque (Frutiger lineage); OCR-B for machine strings — it *is* the
ICAO machine-readable-document standard. Motion behaves like paper and rubber:
60ms stamp settle, 2–3° randomised rotation, faint ink bleed. References:
airport wayfinding, ICAO Doc 9303, security printing, customs stamps, Solari
boards.

**Costs:** Stamp and paper craft must be excellent or it reads as scrapbooking —
no partial credit. Guilloché and MRZ detailing is fiddly SVG. The metaphor
carries political valence; must stay in the travel register, never enforcement.
Mobile is fine (passports are phone-sized) but the terminal map must stack.

**Why reject:** The metaphor can overshadow the engineering — "cute passport
site" rather than deep IAM work. Identity vendors have worn passport imagery
thin, so insiders may sigh on arrival. Skeuomorphism ages badly if craft slips.

---

## 2. The Strip Chart

**Conceit:** Your sign-in is a physical event that lasted 1.4 seconds; this site
is the instrument that recorded it. Time is ground truth — every module is a
different reading of the same recording, drawn in ink on chart paper.

**First 10 seconds:** Warm ivory ruled with a faint orange-red chart grid. A live
pen trace draws left to right at paper speed — the site's heartbeat — ticking a
red event mark when anyone signs in anywhere. A slab-serif nameplate stamped like
an instrument's front panel: "IDENTITY WORK IS INVISIBLE IN PRODUCTION. THIS
INSTRUMENT RECORDS IT." Two printed toggles: GUIDED / SANDBOX. The pen never
stops.

**Guided vs sandbox:** Guided replays your recording at 1/20th speed, callout
flags pinning one at a time. Sandbox is the full logic analyzer: four channels
(browser, IdP, token, policy) on a shared time axis, scrubbable, zoomable, raw
payload at every mark — and recordings *overlay*. Passkey vs password overlaid
is the auth-methods arena solved as a picture: the passkey trace is visibly
shorter. Conditional access is a channel that sits flat until it fires and forks
the trace into the MFA detour. SCIM is the long recording — webhook hops arriving
like a distant quake reaching successive stations. The token inspector gains what
no table has: each claim flagged at the point in the pipeline where it *entered*.

**The recruiter moment:** The pen draws their sign-in at true 1:1 speed. It's
over in 1.4 seconds; the line stops. "That was it. The white flicker between
clicking Sign in and seeing this page. Recorded." Then the strip *stretches* —
the same 1.4 seconds filling the screen — and there are fourteen flagged events
inside the flicker. The moment is the stretch: something experienced as an
instant becomes a landscape. Hands Steve the interview line: *"my whole career
happens inside that flicker."*

**Visual language:** Ivory, ink blue-black traces, signal red for events, nothing
else. Slab/typewriter for annotations (lab-notebook voice); engineering grotesque
(DIN 1451 tradition) for axes; tabular figures; monospace strictly for machine
values. One motion verb: *drawing*. Nothing fades, nothing floats. Perforated
sprocket edges as border motif. References: strip-chart and EKG recorders,
seismographs, logic-analyzer timing diagrams, NASA flight-data plots, Tufte, DIN
drafting, and Muybridge — whose motion studies are exactly this move.

**Costs:** The replay must be *true* or engineers will catch it — and the span
between redirect-out and redirect-back is opaque to the client. Either correlate
server-side or label unobservable spans honestly ("opaque to the client;
reconstructed"), which done well is itself credibility. Horizontal time fights
portrait phones; honest fix is rotating the strip vertical on mobile
(seismographs are vertical) — a real redesign, not a reflow. Coldest of the three.

**Why reject:** Sits closest to the disqualified pole — one bad palette decision
and it's a monitoring dashboard. Paper discipline is the entire defence. Won't
show any playfulness.

---

## 3. Museum of Invisible Work

**Conceit:** A small museum whose exhibits don't exist until you arrive. Wall
labels, vitrines, an accession ledger, a catalogue — full curatorial apparatus
applied to objects that normally live for milliseconds in a log.

**First 10 seconds:** Warm gallery white, enormous quiet type: "MUSEUM OF
INVISIBLE WORK." Beneath, small: "The artifacts in this collection do not exist
yet. They will be made when you sign in." A floor plan with two entrances:
"Guided tour — 15 minutes, numbered stops" / "Open storage — everything out,
minimal labels." One live element, in registrar's language: "Most recent
acquisition: ID token, acquired 41 seconds ago. Deaccession in 59 minutes."

**Guided vs sandbox:** Guided is the numbered tour, one room per module, wall
text in curatorial second person. Sandbox borrows a real museum convention —
*open storage*: the collection racked dense and visible, accession numbers only,
every payload exposed, minimal interpretation — plus the demonstration room where
live modules run. Provisioning maps onto accession/deaccession exactly.

**The recruiter moment:** A vitrine holding their token as an object, with a wall
label: *"ID TOKEN (2026). Signed JSON Web Token; RS256; 1,289 bytes. Issued by
Microsoft Entra External ID for this collection. Acquired 12 seconds ago directly
from the issuer. On loan until 15:42 UTC, at which point it expires and this label
will be retired. One of one: no other copy of this object exists."* The moment is
"one of one." Medium, dimensions, provenance, loan period — language every
museumgoer reads — applied deadpan to a thing manufactured for them twelve
seconds ago. The museum's two-register tradition solves the two-audience problem
structurally: wall label for the public, "catalogue entry" link for the scholarly
apparatus. Wall text and catalogue raisonné have coexisted for 150 years.

**Visual language:** Gallery off-white, warm grey, ink black, one didactic accent
(archival red or ultramarine). Serious serif for wall text; neutral grotesque for
captions; small caps and accession-number styling. Objects are *placed* — 200ms
settle, single-source shadow growing. Motion spent only on live demonstration
rooms, so machinery feels alive against stillness. The 16 claims as a specimen
drawer — pinned, tagged, entomology-tray style. References: Swiss International
Style catalogues, wall-label anatomy, auction-catalogue typography, conservation
reports, natural-history specimen trays, visible storage.

**Costs:** Tone is everything — one inch past deadpan and it's pretentious. Label
prose is load-bearing; this is a writing project as much as a design project.
Stillness fights skimming recruiters. Serif-led editorial typography on the web is
fiddly for a front-end newcomer. Mobile is the best of the three — a wall label is
a phone-sized object.

**Why reject:** Least *engineering* of the three. A hiring manager may leave
thinking "he writes beautifully about identity" rather than "he runs this
machinery." For a portfolio whose thesis is about work, that's a real miscue.

---

## Fable's recommendation

**Build Port of Entry. Runner-up: Strip Chart. Reject Museum first.**

Reject Museum first because its failure mode is baked into the concept rather
than the execution: its best quality — stillness, restraint, deadpan — directly
contradicts the site's core asset, which is live systems running under a
visitor's hands. Steal its label-register writing for the guided path regardless.

Port of Entry wins the test that matters most: a non-technical recruiter, on a
phone, cold, in thirty seconds. The MRZ decode requires nothing of the viewer —
recognition does the work. Everyone has held a passport; nobody has seen its
gibberish decode; here it decodes into *their own name*. The stretch asks them to
care about a flicker; the wall label asks them to enjoy dry wit; the MRZ asks
nothing. It also has the richest module mapping, so the metaphor keeps paying as
modules ship rather than being a landing-page costume.

Two caveats: the passport metaphor is worn thin in vendor decks, so execution
must be insider-correct — real OCR-B, real ICAO layout, real byte-range
highlighting — precision as the antidote to clip-art. And its main risk is craft:
stamps and paper are hard, with no partial credit. If early visual passes can't
clear that bar, fall back to Strip Chart, whose craft is more forgiving and whose
depth buys the most respect from engineers who probe.

**One idea ports either way and shouldn't be lost:** per-claim provenance — which
config stage put this claim in your token — is content, not skin, and it's the
strongest technical differentiator on the list.
