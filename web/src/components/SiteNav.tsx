/**
 * The site header. Wordmark left, modules right, on every page.
 *
 * ── WHY IT LOOKS LIKE EVERY OTHER SITE'S HEADER ──────────────────────────────
 *
 * The first version was a row of small grey monospace links floating above the
 * page content with no bar around it. Steve wrote an entire message asking for
 * navigation before noticing it was already there — which is the only review a
 * nav bar really needs, and it failed.
 *
 * His note: "how do web pages do navigation to different sections? I don't think
 * we need to reinvent the wheel here." Correct. A bordered bar pinned to the top,
 * wordmark on the left, links on the right, current page marked. Nobody has to
 * learn it, which is the entire point of a convention.
 *
 * The second attempt was a real bar and he still said "I think they are still too
 * hard to see". Raising the link contrast helped — slate-200 at medium weight,
 * with the current item underlined — but it was not the actual problem.
 *
 * THE ACTUAL PROBLEM, diagnosed by Steve's wife in one sentence: the bar had no
 * background. It was bg-slate-950/85 sitting on a bg-slate-950 page, so the
 * header was the same colour as the page and there was no band for the eye to
 * catch. Every fix before this one adjusted the text inside a container that was
 * invisible.
 *
 * Now slate-800 against a slate-950 page, with a lighter border and a shadow
 * under it. That is what makes it read as chrome rather than as the first line
 * of the content — the same reason essentially every site does it.
 *
 * slate-900 was the first attempt and Steve asked for brighter still. Measured,
 * the bar sits at oklab lightness 0.279 against the page at 0.129 — better than
 * double, which is what a header needs when the page it sits on is nearly black.
 *
 * STICKY, because the pages it serves are long. /scim runs past a live
 * transcript and the token inspector scrolls for a while; navigation that leaves
 * the screen is navigation you have to hunt for, which is how this started.
 *
 * ── WHAT IS NOT IN IT ────────────────────────────────────────────────────────
 *
 * /app2 and /guest, deliberately. Neither is a page to browse: /guest is a live
 * B2B sign-up that creates a real directory object, and /app2 proves nothing
 * without an existing session — it is linked from the token panel, and only once
 * you are signed in, for exactly that reason. A persistent nav entry would invite
 * a visitor to wander into a credential prompt.
 *
 * Four items, and it should stay four. Visitors have already called this site
 * crowded, and a nav bar is the easiest place in the world to keep adding things.
 */

interface NavItem {
  href: string
  label: string
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Token inspector' },
  { href: '/accounts', label: 'Account types' },
  { href: '/scim', label: 'SCIM' },
  { href: '/cleanup', label: 'Self-destruct' },
]

export function SiteNav({ current }: { current: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-600/70 bg-slate-800/95 shadow-lg shadow-slate-950/60 backdrop-blur">
      <nav
        aria-label="Modules"
        className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3"
      >
        {/* The wordmark links home from every page including home, which is the
            convention and costs nothing. Hidden on the narrowest screens so the
            four module names get the width instead: on a phone the wordmark is
            the least useful thing here, because the page title says it anyway. */}
        <a
          href="/"
          className="hidden text-sm font-semibold tracking-tight text-white transition hover:text-emerald-200 sm:block"
        >
          The Identity Playground
        </a>

        <ul className="flex flex-1 flex-wrap items-center gap-x-7 gap-y-1 sm:justify-end">
          {ITEMS.map((item) => {
            const isCurrent = item.href === current
            return (
              <li key={item.href}>
                {isCurrent ? (
                  // Not a link. A nav item pointing at the page you are already
                  // on is a dead control, and aria-current is how a screen reader
                  // is told where it is.
                  <span
                    aria-current="page"
                    className="block border-b-2 border-emerald-400 pb-1 text-[0.95rem] font-semibold text-emerald-300"
                  >
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    className="block border-b-2 border-transparent pb-1 text-[0.95rem] font-medium text-slate-200 transition hover:border-slate-600 hover:text-white"
                  >
                    {item.label}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </header>
  )
}
