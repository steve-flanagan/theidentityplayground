// Shoots the token inspector with one claim's annotation open, and writes a PNG.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A STILL AND NOT A GIF
//
// capture-demo.mjs deliberately does NOT capture this panel, and its reasoning
// stands: the inspector is "mostly a wall of text, which is the worst thing to
// put in a GIF". Nothing here moves except an accordion opening. Animation would
// buy one frame of content and cost a megabyte, and a 128-colour palette turns
// small monospace text to mush -- which is most of what this panel is.
//
// A still is the right format for the same reason: text is what PNG is good at.
// One frame with an annotation open shows the whole product -- claims on the
// left, values on the right, and the annotation underneath proving the panel
// explains rather than just decodes.
//
// It also has to survive a corporate web filter. The domain was registered on
// 16 July 2026, so enterprise DPI blocks it as a newly-registered domain for
// roughly the first month, and a chunk of the audience for this project reads
// from exactly those networks. github.com is not blocked. This image is how
// they see Module 1 at all.
//
// ── WHICH CLAIM ──────────────────────────────────────────────────────────────
//
// `iss` by default. Its annotation carries the gotcha that the issuer host is
// NOT the host you called -- endpoints sit on the tenant-name subdomain while
// `iss` uses the tenant-GUID one -- which is the detail most likely to make an
// Entra developer recognise that someone who has actually shipped this wrote it.
// Override with --claim if a better one turns up.
//
//   npm run capture:inspector --prefix web
//   npm run capture:inspector --prefix web -- --url http://localhost:5173
//   npm run capture:inspector --prefix web -- --claim idp
//
// First run needs the browser binary, once:
//
//   npx playwright install chromium
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))

// ── Arguments ────────────────────────────────────────────────────────────────
// Plain parsing, same shape as capture-demo.mjs. No dependency for five flags.

const defaults = {
  url: 'https://theidentityplayground.com',
  out: resolve(here, '../../docs/inspector.png'),
  // Deliberately UNDER Tailwind's lg breakpoint (1024). Above it the inspector
  // is pinned into a 27rem sticky column beside the timeline; below it the grid
  // collapses to one column and the panel gets the full width. Wider means the
  // long GUID values stop wrapping, which is the difference between a readable
  // still and a ragged one.
  width: 1000,
  // Only needs to be tall enough that the card is not scroll-clipped while
  // Playwright walks it. The element screenshot captures the whole card
  // regardless of what fits on screen.
  height: 1400,
  claim: 'iss',
}

const argv = process.argv.slice(2)
const options = { ...defaults }

for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i].replace(/^--/, '')
  const value = argv[i + 1]
  if (!(key in defaults)) {
    console.error(`Unknown option: ${argv[i]}`)
    console.error(`Known: ${Object.keys(defaults).map((k) => '--' + k).join(' ')}`)
    process.exit(1)
  }
  options[key] = typeof defaults[key] === 'number' ? Number(value) : value
}

// ── Capture ──────────────────────────────────────────────────────────────────

console.log(`Capturing ${options.url}`)
console.log(`  ${options.width}x${options.height} viewport, expanding "${options.claim}"`)

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: options.width, height: options.height },
  // Stated rather than inherited, so two runs on two machines match.
  colorScheme: 'dark',
  deviceScaleFactor: 2, // Retina-density text. It is a text panel; it earns the bytes.
})

await page.goto(options.url, { waitUntil: 'networkidle' })

// Signed out, the panel is headed "Sample ID token". Anchor on the heading and
// climb to its own <section> -- App.tsx wraps this in ANOTHER section that also
// contains the heading, so filtering sections by heading matches both. The
// ancestor walk is unambiguous where a `.filter({ has })` is not.
const heading = page.getByRole('heading', { name: 'Sample ID token', exact: true })
await heading.waitFor({ state: 'visible', timeout: 30_000 })
const card = heading.locator('xpath=ancestor::section[1]')

await card.scrollIntoViewIfNeeded()
// Let the scroll settle, or the shot catches the page mid-motion.
await page.waitForTimeout(400)

// Every claim row is a button carrying aria-expanded, with the claim name in its
// own span. Match the span exactly: `iss` as a substring would also hit any row
// whose value happens to contain it.
const row = card
  .locator('button[aria-expanded]')
  .filter({ has: page.locator(`span:text-is("${options.claim}")`) })

const found = await row.count()
if (found !== 1) {
  console.error(`Expected exactly one claim row for "${options.claim}", found ${found}.`)
  console.error('The sample token or the inspector markup changed. Fix the selector, not the page.')
  await browser.close()
  process.exit(1)
}

await row.click()
// Wait on the state the click is supposed to produce rather than a sleep, so a
// slow machine makes the run longer instead of making the image wrong.
await row.waitFor({ state: 'visible' })
await page.waitForFunction(
  (name) => {
    const spans = [...document.querySelectorAll('button[aria-expanded] span')]
    const match = spans.find((s) => s.textContent?.trim() === name)
    return match?.closest('button')?.getAttribute('aria-expanded') === 'true'
  },
  options.claim,
  { timeout: 10_000 },
)
// The annotation is a plain conditional render, not a transition, but give the
// reflow a frame to land before the shutter.
await page.waitForTimeout(250)

const shot = await card.screenshot({ type: 'png' })
await browser.close()

await mkdir(dirname(options.out), { recursive: true })
await writeFile(options.out, shot)

const kb = (shot.length / 1024).toFixed(0)
console.log(`Wrote ${options.out}  (${kb} KB)`)
