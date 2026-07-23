// Drives the account-types map through all three account types and writes a GIF.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The Module 1 GIF was recorded by hand, and it was miserable enough that it did
// not get redone when Module 2 shipped. Hand-recording is also the wrong tool for
// this clip: it is three clicks on a control that has exactly three states, so it
// should be reproducible rather than performed.
//
// Regenerate it every time a module ships. A stale GIF is the most visible kind
// of stale doc: it sits above the fold and cannot be grepped.
//
// ── WHAT IT CAPTURES, AND WHY THIS AND NOT THE INSPECTOR ─────────────────────
//
// Same person, three directory objects: CIAM customer, workforce member, B2B
// guest. Click each and its potential blast radius lights up across two tenants,
// their subscriptions, and the app.
//
// An earlier version of this script captured the token inspector swapping from
// customer to member. It was rejected for the right reason: it never showed
// Module 2 at all. The inspector is the Module 1 story, and it is also mostly a
// wall of text, which is the worst thing to put in a GIF.
//
// This clip is the opposite. The map's TEXT is identical in all three states --
// only the colouring moves -- so it is the rare thing a still cannot show and
// prose cannot describe. That is what earns it an animation.
//
// FRAMES ARE CLIPPED TO THE SECTION, not the viewport. A full-page shot spends
// most of its pixels on layout, and on a 128-colour palette that is what makes
// small text turn to mush. Cropping to the element means the palette is spent on
// the thing being demonstrated.
//
//   npm run capture --prefix web
//   npm run capture --prefix web -- --url http://localhost:5173
//
// First run needs the browser binary, once:
//
//   npx playwright install chromium
//
// ── ON SIZE ──────────────────────────────────────────────────────────────────
//
// GIF is a terrible video codec and a fine animation format. The levers, in the
// order worth pulling: --fps down, --hold down, --colors down. Under about 5 MB
// is a safe target for both LinkedIn and a README that has to load.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { PNG } from 'pngjs'
// gifenc ships CommonJS, so its exports arrive on the default import rather than
// as named ones. Destructuring the named form fails at parse time under ESM.
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc

const here = dirname(fileURLToPath(import.meta.url))

// The three states, in the order the picker shows them. Customer first because
// that is the account type a visitor of this site actually is.
const ACCOUNT_TYPES = ['CIAM Customer', 'Workforce member', 'B2B guest']

// ── Arguments ────────────────────────────────────────────────────────────────
// Plain parsing, same as har-to-timings.mjs. No dependency for seven flags.

const defaults = {
  url: 'https://theidentityplayground.com',
  out: resolve(here, '../../docs/demo.gif'),
  // Under Tailwind's lg breakpoint (1024) the page drops to a single column and
  // the map gets the full width instead of sharing it with the claims panel.
  // That is a bigger, more readable map, which is the whole point of the clip.
  width: 1000,
  height: 1100,
  fps: 8,
  // Seconds held on each account type. Long enough to read the lit nodes, short
  // enough that a three-state loop does not outstay its welcome.
  hold: 1.8,
  colors: 128,
  // One PNG per account type beside the GIF. A still cannot show the transition,
  // but three stills side by side make the same point in places that will not
  // play an animation.
  stills: 'yes',
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

const frameDelay = Math.round(1000 / options.fps)
const framesPerState = Math.round(options.hold * options.fps)

console.log(`Capturing ${options.url}`)
console.log(`  ${options.width}x${options.height} viewport, ${options.fps} fps, ${options.hold}s per account type`)

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: options.width, height: options.height },
  // Say it rather than inheriting whatever the runner defaults to, so two runs
  // on two machines produce the same frames.
  colorScheme: 'dark',
  deviceScaleFactor: 1,
})

await page.goto(options.url, { waitUntil: 'networkidle' })

// Wait for the thing being demonstrated rather than a fixed sleep, so a slow
// network makes the run longer instead of making the GIF wrong.
const section = page.locator('section').filter({
  has: page.getByRole('heading', { name: /Account types/i }),
})
await section.waitFor({ state: 'visible', timeout: 30_000 })
await section.scrollIntoViewIfNeeded()
// Let the scroll settle, or frame 1 opens mid-scroll.
await page.waitForTimeout(400)

const frames = []
const stills = {}

for (const accountType of ACCOUNT_TYPES) {
  await section.getByRole('button', { name: accountType, exact: true }).click()

  // Capture from immediately after the click, so the colour transition is in
  // the clip rather than being skipped over. The change IS the content.
  for (let i = 0; i < framesPerState; i++) {
    const shot = await section.screenshot({ type: 'png' })
    frames.push(shot)
    // The last frame of each state is the settled one, so it is the still worth
    // keeping.
    stills[accountType] = shot
    await page.waitForTimeout(frameDelay)
  }
}

await browser.close()
console.log(`  ${frames.length} frames across ${ACCOUNT_TYPES.length} account types`)

// ── Encode ───────────────────────────────────────────────────────────────────

const decoded = frames.map((buffer) => PNG.sync.read(buffer))
const { width, height } = decoded[0]

// An element screenshot is only stable if the element does not reflow, and a
// reflow here would silently produce a GIF whose frames are different sizes.
// gifenc would not complain; the result would just be garbage from the first
// mismatch onward. Fail loudly instead.
const oddSize = decoded.find((f) => f.width !== width || f.height !== height)
if (oddSize) {
  console.error(`Frames are not all ${width}x${height} (found ${oddSize.width}x${oddSize.height}).`)
  console.error('The section reflowed mid-capture, so the clip would be corrupt.')
  process.exit(1)
}

// One palette for the whole clip, built from a middle frame. Per-frame palettes
// would track colour better and would also shimmer on every frame, which on a
// mostly-static panel reads as noise.
const palette = quantize(decoded[Math.floor(decoded.length / 2)].data, options.colors, {
  format: 'rgb565',
})

const encoder = GIFEncoder()
for (const frame of decoded) {
  encoder.writeFrame(applyPalette(frame.data, palette, 'rgb565'), width, height, {
    palette,
    delay: frameDelay,
  })
}
encoder.finish()

const gif = Buffer.from(encoder.bytes())
await mkdir(dirname(options.out), { recursive: true })
await writeFile(options.out, gif)

if (options.stills === 'yes') {
  const base = options.out.replace(/\.gif$/, '')
  for (const [accountType, shot] of Object.entries(stills)) {
    const slug = accountType.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await writeFile(`${base}-${slug}.png`, shot)
  }
  console.log(`  stills: ${Object.keys(stills).length} written beside the gif`)
}

const mb = (gif.length / 1024 / 1024).toFixed(2)
console.log(`Wrote ${options.out}  ${width}x${height}  (${mb} MB)`)
if (gif.length > 5 * 1024 * 1024) {
  console.log('Over 5 MB. Try --fps 6, then --hold 1.4, then --colors 96.')
}
