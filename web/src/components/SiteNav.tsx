/**
 * The same four links on every page.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 *
 * Steve, after the modules moved to their own pages: "when you go to scim there
 * is no way to go back to main."
 *
 * There WAS a "Back to the playground" link, at the bottom of each page. On
 * /scim that puts it under a live transcript, which is to say nowhere. A link
 * nobody scrolls to is not navigation, and the moment the site became four pages
 * instead of one, the bottom of the page stopped being an acceptable answer.
 *
 * ── WHAT IS NOT IN IT ────────────────────────────────────────────────────────
 *
 * /app2 and /guest, deliberately. Neither is a page to browse: /guest is a live
 * B2B sign-up flow that creates a real directory object, and /app2 proves
 * nothing without an existing session — it is linked from the token panel, and
 * only once you are signed in, for exactly that reason. Putting either in a
 * persistent nav would invite a visitor to wander into a credential prompt.
 *
 * Four items, and it stays four. This is a site whose visitors have already said
 * it feels crowded; a nav bar is the easiest place in the world to keep adding
 * things.
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
    <nav aria-label="Modules" className="mb-10 border-b border-slate-800/70 pb-3">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {ITEMS.map((item) => {
          const isCurrent = item.href === current
          return (
            <li key={item.href}>
              {isCurrent ? (
                // Not a link. A nav item that navigates to the page you are
                // already on is a dead control, and marking it with
                // aria-current is how a screen reader is told where it is.
                <span
                  aria-current="page"
                  className="font-mono text-xs tracking-wide text-emerald-300"
                >
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href}
                  className="font-mono text-xs tracking-wide text-slate-500 transition hover:text-slate-200"
                >
                  {item.label}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
