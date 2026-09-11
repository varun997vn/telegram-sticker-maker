# Sticker Maker

Turn images and videos into WhatsApp and Telegram stickers, entirely in your
browser. Nothing is uploaded: decoding, editing and encoding all happen on your
own machine, which is also what lets the whole thing be hosted as a static site
on GitHub Pages.

## What it does

- **Images in** — drop, pick or paste a PNG, JPEG, WebP, GIF, AVIF or BMP.
- **Videos in** — MP4, WebM, MOV, MKV or OGV, with a live preview of the
  sticker as you edit it.
- **Captions** — as many text layers as you like, dragged into place, with
  control over font, colour, outline, shadow, rotation, opacity, alignment,
  line spacing, wrapping and case.
- **Stickers out** — each one checked against the platform's rules by reading
  the file that was actually produced, not by trusting the encoder.
- **Packs** — collect stickers from several sources into one archive, complete
  with the metadata each platform expects.

## The formats it produces

| Output | Format | Max size | Dimensions | Other constraints |
| ------ | ------ | -------- | ---------- | ----------------- |
| Telegram sticker | WebP | 512 KB | 512 px on the longest side | alpha preserved |
| Telegram video sticker | WebM / VP9 | 256 KB | 512 px on the longest side | ≤ 3.0 s, ≤ 30 fps, no audio |
| WhatsApp sticker | WebP | 100 KB | exactly 512×512 | alpha preserved |
| WhatsApp animated sticker | animated WebP | 500 KB | exactly 512×512 | ≤ 3.0 s |
| WhatsApp tray icon | PNG | 50 KB | 96×96 | generated for pack export |

Size limits are read as decimal kilobytes (1 KB = 1000 bytes). Neither platform
says which it means, and the decimal reading is the stricter one, so an export
that passes here cannot be rejected for size.

Animations are capped at **3 seconds** for every target. WhatsApp tolerates
longer, but Telegram does not, and one edit should export to both without a
second pass.

A longer clip is **not cut short**. The whole of whatever you select is kept
and sampled across its full length, so a ten-second clip becomes a three-second
sticker covering all ten — played faster. The editor previews it at that speed
and the controls say what the factor is. Select a shorter range if you want
normal speed.

When a sticker will not fit its budget, the encoder lowers quality first and
frame rate second — a caption that has gone illegible hurts a sticker more than
a few dropped frames do.

## Installing the stickers

**Telegram.** Open a chat with [@Stickers](https://t.me/stickers) and send
`/newpack` for still stickers or `/newvideo` for video ones. Send each file as a
**file**, not as a photo or video, so Telegram does not recompress it.

**WhatsApp.** WhatsApp has no direct import for pack archives. Add stickers one
at a time through a third-party sticker app, or drop the exported folder into
WhatsApp's own sample sticker app — the `contents.json` this tool writes matches
what that app expects.

The exported archive contains a `README.txt` saying the same thing.

## Browser support

Recent Chrome, Edge and Firefox are fully supported. The app checks what your
browser can do when it starts and says so on the affected control rather than
failing partway through an export.

Telegram video stickers need the WebCodecs `VideoEncoder` API. Where it is
missing, that one export is disabled with an explanation and everything else
still works.

Note that Telegram video stickers come out **opaque**. No browser currently
supports VP9 encoding with an alpha channel. Because that target keeps the
source aspect ratio rather than padding to a square, this app never adds
transparency of its own — only a source that is itself transparent loses
anything. WhatsApp's animated stickers keep their alpha.

## How it works

The pipeline is **extract → composite → encode**:

1. **Extract** — ffmpeg.wasm pulls frames out of the source video at the planned
   rate, already scaled and cropped.
2. **Composite** — a canvas draws the text layers over each frame.
3. **Encode** — the frames become WebM or animated WebP, re-encoded at
   decreasing quality until the result fits its byte budget.

Still images skip ffmpeg entirely and go through the canvas, so they export
instantly and the 32 MB ffmpeg core is only fetched by people who export an
animation.

ffmpeg.wasm uses the **single-threaded** core, which needs no `SharedArrayBuffer`
and therefore no COOP/COEP headers — GitHub Pages cannot set those. VP9 is
encoded by the browser instead of ffmpeg, for reasons recorded in
[ROADMAP.md](./ROADMAP.md#stage-5--animated-sticker-export-).

## Development

```sh
npm install
npm run dev          # start the dev server
npm run typecheck    # tsc --noEmit
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright, Chromium)
npm run build        # production build into dist/
```

`npm run test:all` runs the typecheck, unit and browser suites in sequence — the
same things CI runs.

The ffmpeg core is copied out of `node_modules` into `public/ffmpeg/` before
each build by `scripts/sync-ffmpeg-core.mjs`, so it is served from the same
origin as the app rather than from a CDN. Those files are gitignored and
regenerated rather than committed.

### Testing approach

- **Unit tests** cover the pure core: platform rules, geometry, frame planning,
  the byte-budget search, and the WebP, WebM, PNG and ZIP readers and writers.
- **Browser tests** drive the real interface against real encoders, then decode
  what was downloaded and check it. Assertions are made about the bytes that
  came out, never about the settings that went in.
- **Fixtures are generated, not committed** — images by a small PNG encoder,
  videos by the app's own VP9 encoder, so no binaries live in the repository.
- **Writers are checked against independent implementations**: the ZIP writer
  against the system `unzip`, the WebM writer against ffmpeg decoding its
  output.

### Deployment

Pushes to `main` build the site and publish it to GitHub Pages via
`.github/workflows/deploy.yml`. The repository's **Settings → Pages → Source**
must be set to **GitHub Actions** for that workflow to succeed.

The build's base path defaults to `/telegram-sticker-maker/` to match the
project site URL. Set `BASE_PATH=/` when serving from a domain root.

## Privacy

There is no server. No file you open is uploaded, and no analytics are
collected. The only network requests the app makes are for its own code and,
when you export an animation, the ffmpeg core — both from the same origin that
served the page.
