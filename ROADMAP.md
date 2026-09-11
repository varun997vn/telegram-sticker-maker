# Roadmap

A browser-only sticker maker: images and video in, spec-compliant WhatsApp and
Telegram stickers out. No server, no upload — the whole pipeline runs on the
user's machine and the site is static enough to live on GitHub Pages.

Each stage ends with a green test suite and a commit. Stages are tackled one at
a time, with sign-off before the next one starts.

## Status

| Stage | Scope | State |
| ----- | ----- | ----- |
| 0 | Foundation, test harness, CI, Pages deploy | ✅ Done |
| 1 | Sticker specs, geometry, frame planning, byte-budget search | ✅ Done |
| 2 | Image → static sticker export | ✅ Done |
| 3 | Text overlay editor | ⬜ Not started |
| 4 | ffmpeg.wasm integration and video frame extraction | ⬜ Not started |
| 5 | Animated sticker export | ⬜ Not started |
| 6 | Sticker pack export | ⬜ Not started |
| 7 | Polish, docs, accessibility | ⬜ Not started |
| 8 | Background removal (optional) | ⬜ Not started |

## Target formats

These limits drive every encoder decision in the app.

| Output | Format | Max size | Dimensions | Other constraints |
| ------ | ------ | -------- | ---------- | ----------------- |
| Telegram static | WebP | 512 KB | 512 px on the longest side | alpha preserved |
| Telegram video sticker | WebM / VP9, `yuva420p` | 256 KB | 512 px on the longest side | ≤ 3.0 s, 30 fps, no audio stream |
| WhatsApp static | WebP | 100 KB | exactly 512×512 | alpha preserved |
| WhatsApp animated | animated WebP | 500 KB | exactly 512×512 | ≤ 3.0 s |
| WhatsApp tray icon | PNG | 50 KB | 96×96 | pack export only |

Two deliberate product decisions:

- **Animation length is capped at 3.0 s for every target.** WhatsApp tolerates
  longer, but Telegram does not, and a single edit should be exportable to both
  without a second pass.
- **Frame rate is adaptive, not fixed.** 256 KB of 512×512 VP9 is a tight
  budget, so the encoder starts at 30 fps / high quality and steps down
  (30 → 24 → 15 fps, then quality) until the output fits. Guessing a bitrate up
  front would either blow the limit or waste quality.

## Architecture

Static single-page app — Vite, TypeScript, React, plain CSS.

The pipeline is **extract → composite → encode**:

1. **Extract** — ffmpeg.wasm pulls scaled and cropped frames out of the source
   video at the planned frame rate.
2. **Composite** — a canvas draws the text layers over each frame.
3. **Encode** — ffmpeg.wasm encodes the frames to WebM/VP9 or animated WebP,
   retrying with a tighter budget until the size limit is met.

Static images skip ffmpeg entirely and go straight through the canvas
`toBlob('image/webp')` path, so the 32 MB ffmpeg core is only fetched when a
user actually exports something animated.

ffmpeg.wasm uses the **single-threaded** core, which needs no `SharedArrayBuffer`
and therefore no COOP/COEP headers — GitHub Pages cannot set those.

## Stages

### Stage 0 — Foundation ✅

- [x] Vite + TypeScript + React scaffold with strict compiler settings
- [x] Vitest for unit tests, Playwright (Chromium) for browser tests
- [x] GitHub Actions: typecheck, unit tests, build, end-to-end tests
- [x] GitHub Actions: build and deploy to GitHub Pages on `main`
- [x] `ROADMAP.md` as the tracking document

### Stage 1 — Sticker specs and core maths ✅

- [x] Declarative spec table for all five outputs (`src/core/specs.ts`)
- [x] Fit / crop / letterbox geometry for arbitrary source aspect ratios
      (`src/core/geometry.ts`)
- [x] Frame planning: trim window, frame rate and frame count
      (`src/core/framePlan.ts`)
- [x] Byte-budget search: pure, encoder-agnostic, driven by an injected encode
      function (`src/core/budget.ts`)
- [x] WebP, WebM and PNG header parsers (`src/core/formats/`)
- [x] Compliance checker that validates a file against a target by reading the
      bytes, not by trusting encoder settings (`src/core/compliance.ts`)
- [x] 219 unit tests, including cross-module specs asserting that what the
      planners decide is what the compliance checker accepts

Notes on the design:

- **The budget search is a binary search, not a scan.** Candidates are supplied
  worst-last in quality order and probed by lower-bound binary search, so the
  best fitting candidate is found in O(log n) encodes. Real encoders are only
  approximately monotonic, so the returned result is always a candidate that
  was actually measured under the limit rather than an extrapolation.
- **Parsers exist so tests can distrust the encoder.** Asserting that ffmpeg
  was asked for 30 fps proves nothing; the parsers let later stages assert what
  the produced file actually contains.

### Stage 2 — Image → static sticker ✅

- [x] File input by drag-and-drop, file picker and clipboard paste, with EXIF
      orientation applied so phone photos are not silently rotated
- [x] Canvas composition with a transparent background and a contain/cover
      framing toggle
- [x] WebP export through the canvas, quality-searched down to the size cap
- [x] Per-target cards showing real size, dimensions and chosen quality, each
      validated by the Stage 1 compliance checker before it is offered
- [x] Browser tests that upload a real PNG, download the produced sticker and
      re-parse the saved bytes

Notes on the design:

- **Still exports never touch ffmpeg.** Browsers encode WebP natively, so a
  still sticker is instant and the 32 MB wasm core stays unfetched until
  someone exports an animation.
- **Results are keyed to the settings that produced them.** A card falls back
  to "Encoding…" in the same commit that changes the image or the framing, so
  a stale size is never shown for a frame — and a test can never read one and
  believe it.
- **Test fixtures are generated, not committed.** `tests/helpers/pngEncoder.ts`
  is a small RGBA PNG encoder, which keeps real images out of the repository
  and lets a test ask for input with specific properties — a smooth gradient
  that compresses easily, or noise that does not.

### Stage 3 — Text overlay editor

- [ ] Multiple text layers with drag positioning
- [ ] Font family, size, colour, outline, shadow, rotation, opacity
- [ ] Layer list: reorder, duplicate, delete
- [ ] Unit tests for the layout model; end-to-end test for the rendered result

### Stage 4 — ffmpeg.wasm integration

- [ ] Lazy-loaded worker wrapper with progress reporting and cancellation
- [ ] Same-origin hosting of the core files (copied into `public/` at build)
- [ ] Typed argument builders for every encode the app performs
- [ ] Video frame extraction at the planned frame rate and dimensions
- [ ] Tests against a fixture video generated during the test run

### Stage 5 — Animated sticker export

- [ ] Telegram WebM / VP9 export with alpha
- [ ] WhatsApp animated WebP export
- [ ] Budget search wired to the real encoder
- [ ] Trim, crop and frame-rate controls with a live preview
- [ ] End-to-end tests asserting the 256 KB / 500 KB caps, duration and size

### Stage 6 — Sticker pack export

- [ ] Multi-sticker gallery
- [ ] ZIP export
- [ ] WhatsApp `contents.json` and 96×96 tray icon
- [ ] Telegram import metadata
- [ ] Tests on the archive contents

### Stage 7 — Polish

- [ ] Responsive layout down to phone width
- [ ] Keyboard navigation and screen-reader labels
- [ ] Error states for unsupported files and failed encodes
- [ ] README with usage and browser-support notes
- [ ] Sample assets

### Stage 8 — Background removal (optional)

- [ ] Colour-key / magic-wand background removal with tolerance control
- [ ] Feathered edges
