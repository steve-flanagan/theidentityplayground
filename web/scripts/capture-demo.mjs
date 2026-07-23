// Drives the live site through the no-account demo and writes a GIF of it.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The Module 1 GIF was recorded by hand, and it was miserable enough that it did
// not get redone when Module 2 shipped. Hand-recording is also the wrong tool for
// this particular clip: the thing worth showing is one click changing three
// panels at once, which is deterministic, so it should be reproducible rather
// than performed.
//
// Regenerate it every time a module ships. That is the point. A stale GIF is the
// most visible kind of stale doc, because it is the first thing anyone sees on
// the README and it cannot be grepped.
//
// ── WHAT IT CAPTURES, AND WHY THAT CLIP ──────────────────────────────────────
//
// Load, hold on the customer sample, click "Sign in as Member (sample data)",
// hold on the member view. That one click swaps the token in the inspector, the
// timeline below it, and the blast-radius map, from a CIAM customer to a
// workforce member. Three surfaces, one click, no account.
//
// It deliberately does NOT show a sign-in. A sign-in cannot be scripted here
// (real credentials, real Entra), and it is also the thing most viewers will
// never do. The clip should show the path they will actually take.
//
//   node scripts/capture-demo.mjs
//   node scripts/capture-demo.mjs --url http://localhost:5173 --out ../docs/demo.gif
//
// First run needs the browser binary, once:
//
//   npx playwright install chromium
//
// ── ON SIZE ──────────────────────────────────────────────────────────────────
//
// GIF is a terrible video codec and a fine animation format. This site is dark
// with a lot of small text, which is close to the worst case: many colours in
// the syntax highlighting, and text that turns to mush under heavy quantisation.
// The levers, in the order worth pulling: --fps down, --seconds down, --width
// down, then --colors down. Under about 5 MB is a safe target for both LinkedIn
// and a README that has to load.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { PNG } from 'pngjs'
// gifenc ships CommonJS, so its exports arrive on the default import rather than
// as named ones. Destructuring the named form fails at parse time under ESM.
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc

const here = dirname(fileURLToPath(import.meta.url))

// ── Arguments ────────────────────────────────────────────────────────────────
// Plain parsing, same as har-to-timings.mjs. No dependency for six flags.

const defaults = {
  url: 'https://theidentityplayground.com',
  out: resolve(here, '../../docs/demo.gif'),
  width: 1280,
  height: 800,
  fps: 8,
  // Seconds held on each half of the clip. The first is short because nothing
  // is happening yet; the second is longer because there are three panels to
  // read and a GIF loops without warning.
  before: 1.5,
  after: 3.5,
  colors: 128,
  // Pixels scrolled before the first frame. The hero is three paragraphs the
  // viewer is about to read in the post anyway, and scrolling past it puts the
  // two panels that actually change into the frame instead. Set 0 to keep it.
  scroll: 300,
  // Also write the first and last frame as PNGs beside the GIF. The distribution
  // plan asks for "one screenshot/GIF" and a before/after pair carries the same
  // point as the animation in places that will not play one.
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
const framesBefore = Math.round(options.before * options.fps)
const framesAfter = Math.round(options.after * options.fps)

console.log(`Capturing ${options.url}`)
console.log(`  ${options.width}x${options.height}, ${options.fps} fps, ${options.before + options.after}s`)

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: options.width, height: options.height },
  // The site is dark either way, but say so rather than inheriting whatever the
  // runner's default is, so two runs on two machines produce the same frames.
  colorScheme: 'dark',
  deviceScaleFactor: 1,
})

await page.goto(options.url, { waitUntil: 'networkidle' })

// Wait for the thing being demonstrated rather than a fixed sleep, so a slow
// network makes the run longer instead of making the GIF wrong.
const memberButton = page.getByRole('button', { name: /Sign in as Member/i })
await memberButton.waitFor({ state: 'visible', timeout: 30_000 })

if (options.scroll > 0) {
  await page.evaluate((y) => window.scrollTo(0, y), options.scroll)
  // Let the scroll settle before the first frame, or frame 1 is mid-scroll and
  // the GIF opens on a jolt.
  await page.waitForTimeout(400)
}

const frames = []

async function grab() {
  frames.push(await page.screenshot({ type: 'png' }))
}

async function hold(count) {
  for (let i = 0; i < count; i++) {
    await grab()
    await page.waitForTimeout(frameDelay)
  }
}

// 1. The customer sample, as a visitor first sees it.
await hold(framesBefore)

// 2. The click. Captured across the transition rather than after it, because the
//    change is the content.
await memberButton.click()
await hold(framesAfter)

await browser.close()
console.log(`  ${frames.length} frames`)

if (options.stills === 'yes') {
  const base = options.out.replace(/\.gif$/, '')
  await mkdir(dirname(options.out), { recursive: true })
  await writeFile(`${base}-customer.png`, frames[0])
  await writeFile(`${base}-member.png`, frames[frames.length - 1])
  console.log(`  stills: ${base}-customer.png, ${base}-member.png`)
}

// ── Encode ───────────────────────────────────────────────────────────────────
// One palette for the whole clip, built from a middle frame. Per-frame palettes
// would track colour better and would also shimmer on every frame, which on a
// mostly-static screenshot reads as noise.

const decoded = frames.map((buffer) => PNG.sync.read(buffer))
const { width, height } = decoded[0]

const paletteSource = decoded[Math.floor(decoded.length / 2)].data
const palette = quantize(paletteSource, options.colors, { format: 'rgb565' })

const encoder = GIFEncoder()
for (const frame of decoded) {
  const indexed = applyPalette(frame.data, palette, 'rgb565')
  encoder.writeFrame(indexed, width, height, { palette, delay: frameDelay })
}
encoder.finish()

const gif = Buffer.from(encoder.bytes())
await mkdir(dirname(options.out), { recursive: true })
await writeFile(options.out, gif)

const mb = (gif.length / 1024 / 1024).toFixed(2)
console.log(`Wrote ${options.out}  (${mb} MB)`)
if (gif.length > 5 * 1024 * 1024) {
  console.log('Over 5 MB. Try --fps 6, then --seconds down, then --width 1024.')
}
