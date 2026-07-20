# 007. TypeScript over JavaScript across web/ and api/

**Status:** decided 16 July 2026, migrated the same day in `38ab327`. **In force.** All of
`web/src` and `api/src` is TypeScript with `strict: true`.

Every factual claim below is marked **[M]** if it was read in the repo or its git history
(source given) or **[A]** if it is assumed. The rationale section is Steve's own reasoning,
recorded as given rather than reconstructed.

Sources are cited by section or commit rather than line number, because files move.

---

## Context

The SPA was scaffolded in JavaScript. **[M]** (`2e72aab`, "Scaffold web/ SPA and docs/
structure (Phase 0)", which adds `.jsx` files.) It was migrated to TypeScript later the
same day. **[M]** (`38ab327`, "Migrate web/ to TypeScript".)

So this was a live change to a working codebase, not a choice made on an empty directory.
That is the only reason it needed deciding at all.

## Decision

**TypeScript everywhere, with `strict: true` set explicitly.** **[M]**
(`web/tsconfig.app.json`, `"strict": true`.)

The config was lifted from the official Vite `react-ts` template rather than written from
memory, and `strict` was added because the template omits it. **[M]** (`38ab327`.)

### The reasoning, in Steve's words

TypeScript was seen as **more modern**. The understood tradeoff was that it does more but
takes longer to write, and the writing cost is absorbed because the model writes most of
the code.

That is the whole of it. No performance, hiring, or ecosystem argument was made, and none
is invented here.

**One correction to the framing, kept because this record should be accurate.** TypeScript
does not do more than JavaScript at runtime. The types are erased at build and the
JavaScript that ships is the same JavaScript. What it buys is that a class of error
surfaces before the code runs instead of in front of a visitor. The "takes longer to write"
half is right, and it is the half that got solved.

## Rejected alternatives

**Staying on JavaScript.** It was the status quo, it was working, and migrating cost real
time on day one. It lost on the reasoning above.

**No other language was considered**, and nothing else was ever plausible for a project
that had already committed to one language front and back. **[M]** (`CLAUDE.md`, code
conventions: React front end, Azure Functions on Node.js back end, no Python.)

## Consequences

**It caught a real bug within the migration itself.** `strict` mode found `createRoot()`
being handed `HTMLElement | null`. Vite's own template papers over that with a `!`
assertion; this repo throws a named error instead, so a missing `#root` fails with a
message rather than a null dereference inside React. **[M]** (`38ab327`.)

**The strictness is the point, and the code says so where it matters.**
`web/tsconfig.app.json` carries the note that this is the reason to use TypeScript at all,
and that turning it off means paying the cost without collecting the benefit. **[M]**

**A whole class of config error became a build failure rather than a runtime one.** MSAL's
config is the example: getting the authority fields wrong is now a type error at the point
of writing. **[M]** (`web/src/auth/msalConfig.ts`, the comment at the authority block.)

**It makes hand-editing slower for a human and faster for a model.** This is the tradeoff
Steve named, and it only holds while the model is writing most of the code. If that
changes, the decision is worth revisiting rather than assumed.
