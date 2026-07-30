// Drives a real hire and writes a GIF of the provisioning pipeline.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS ONE EARNS AN ANIMATION AND THE INSPECTOR DID NOT
//
// capture-inspector.mjs argues at length that Module 1 should be a still: it is
// a wall of text, nothing moves, and a 128-colour palette turns small monospace
// to mush. All of that is still true there.
//
// This is the opposite case, and it is the same argument capture-demo.mjs makes
// for the account-types map. The pipeline's CONTENT is barely anything — three
// icons and six words — and the whole point is the ORDER: Entra holds while its
// Graph calls go past, then the connector lights and the SCIM calls go past,
// then the app takes the name. A still shows one instant of that and loses the
// only thing worth showing.
//
// ── IT DRIVES A REAL HIRE ────────────────────────────────────────────────────
//
// Against production by default, which means running this CREATES A REAL DEMO
// EMPLOYEE in The Identity Playground Workforce
// (9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4). That is fine and it is the point: the
// GIF in the README is a recording of the thing working, not a mock-up. The
// account self-destructs within 30 hours like every other one, and the hire
// endpoint's per-IP limit applies, so do not loop this.
//
//   npm run capture:scim --prefix web
//   npm run capture:scim --prefix web -- --url http://localhost:5173
//
// First run needs the browser binary, once:
//
//   npx playwright install chromium
//
// ── ON SIZE ──────────────────────────────────────────────────────────────────
//
// The pipeline strip is wide and short, which is a kind shape for a GIF. Levers
// in the order worth pulling: --fps down, --colors down, then --seconds down.
// Under about 5 MB is a safe target for a README that has to load.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc

const here = dirname(fileURLToPath(import.meta.url))

const defaults = {
  url: 'https://theidentityplayground.com',
  out: resolve(here, '../../docs/scim.gif'),
  width: 1100,
  height: 800,
  fps: 6,
  // How long to record once the first call appears. The sequence is roughly
  // eight seconds at the current pace; a little over that catches the app taking
  // the name and settling.
  seconds: 11,
  colors: 96,
}

const argv = process.argv.slice(2)
const options = { ...defaults }
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i].replace(/^--/, '')
  if (!(key in defaults)) {
    console.error(`Unknown option: ${argv[i]}`)
    console.error(`Known: ${Object.keys(defaults).map((k) => '--' + k).join(' ')}`)
    process.exit(1)
  }
  options[key] = typeof defaults[key] === 'number' ? Number(argv[i + 1]) : argv[i + 1]
}

const frameDelay = Math.round(1000 / options.fps)
const frameCount = Math.round(options.seconds * options.fps)

console.log(`Capturing ${options.url}/scim`)
console.log(`  ${options.width}x${options.height}, ${options.fps} fps, ${options.seconds}s`)
console.log('  NOTE: this creates a real demo employee. It self-destructs within 30 hours.')

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: options.width, height: options.height },
  colorScheme: 'dark',
  deviceScaleFactor: 1,
})

await page.goto(`${options.url}/scim`, { waitUntil: 'networkidle' })

const pipeline = page.locator('section[aria-label="Provisioning pipeline"]')
await pipeline.waitFor({ state: 'visible', timeout: 30_000 })
await pipeline.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)

await page.getByRole('button', { name: 'Hire someone' }).click()

// Wait for the FIRST call to appear rather than a fixed delay. The hire takes
// four or five seconds against Graph, and recording that as dead frames would
// spend a third of the GIF on an idle diagram.
await page
  .locator('[aria-label="Recent calls"] p')
  .first()
  .waitFor({ state: 'visible', timeout: 40_000 })

const frames = []
for (let i = 0; i < frameCount; i++) {
  frames.push(await pipeline.screenshot({ type: 'png' }))
  await page.waitForTimeout(frameDelay)
}

await browser.close()
console.log(`  ${frames.length} frames`)

const decoded = frames.map((buffer) => PNG.sync.read(buffer))
const { width, height } = decoded[0]

// An element screenshot is only stable if the element does not reflow. The
// ticker reserves its height precisely so this holds, but assert it: gifenc
// would not complain, the result would just be garbage from the mismatch on.
const oddSize = decoded.find((f) => f.width !== width || f.height !== height)
if (oddSize) {
  console.error(`Frames are not all ${width}x${height} (found ${oddSize.width}x${oddSize.height}).`)
  console.error('The pipeline reflowed mid-capture, so the clip would be corrupt.')
  process.exit(1)
}

// One palette for the whole clip, built from a middle frame — per-frame palettes
// shimmer, and on a mostly-dark panel that reads as noise.
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

const mb = (gif.length / 1024 / 1024).toFixed(2)
console.log(`Wrote ${options.out}  ${width}x${height}  (${mb} MB)`)
if (gif.length > 5 * 1024 * 1024) {
  console.log('Over 5 MB. Try --fps 5, then --colors 64, then --seconds 9.')
}
