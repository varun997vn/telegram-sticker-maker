# Sticker Maker

Turn images and videos into WhatsApp and Telegram stickers, entirely in your
browser. Nothing is uploaded — decoding, editing and encoding all happen on
your own machine, which is also what lets the whole thing be hosted as a static
site on GitHub Pages.

> **Status:** under construction. See [ROADMAP.md](./ROADMAP.md) for what is
> built and what is coming.

## What it will do

- Take an image or a video as input
- Let you add styled text on top
- Export stickers that actually meet the platform rules:
  - Telegram static (WebP, ≤ 512 KB) and video stickers (WebM/VP9, ≤ 256 KB, ≤ 3 s)
  - WhatsApp static (WebP, ≤ 100 KB) and animated stickers (animated WebP, ≤ 500 KB)

The exact limits and the reasoning behind the frame-rate and duration choices
are documented in [ROADMAP.md](./ROADMAP.md#target-formats).

## Development

```sh
npm install
npm run dev          # start the dev server
npm run typecheck    # tsc --noEmit
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright, Chromium)
npm run build        # production build into dist/
```

`npm run test:all` runs the typecheck, unit and browser suites in sequence —
the same things CI runs.

### Deployment

Pushes to `main` build the site and publish it to GitHub Pages via
`.github/workflows/deploy.yml`. The repository's **Settings → Pages → Source**
must be set to **GitHub Actions** for that workflow to succeed.

The build's base path defaults to `/telegram-sticker-maker/` to match the
project site URL. Set `BASE_PATH=/` when serving from a domain root.
