import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { checkCompliance } from '../../src/core/compliance.ts';
import { parseWebM } from '../../src/core/formats/webm.ts';
import { parseWebP } from '../../src/core/formats/webp.ts';
import { STICKER_SPECS } from '../../src/core/specs.ts';
import { encodePNG } from '../helpers/pngEncoder.ts';

/**
 * The whole animated pipeline against real ffmpeg.wasm: a video in, a
 * spec-compliant animated sticker out, verified by re-parsing the bytes.
 */

const telegramVideo = STICKER_SPECS['telegram-video'];
const whatsappAnimated = STICKER_SPECS['whatsapp-animated'];

test.describe.configure({ timeout: 300_000 });

/** Deterministic pseudo-random values, so a fixture is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth, easily compressed frame: a moving band on a flat ground. */
function simpleFrame(width: number, height: number, index: number, total: number): Uint8Array {
  const band = Math.floor((index / total) * height);
  return encodePNG(width, height, (_x, y) =>
    Math.abs(y - band) < height / 8 ? [240, 80, 40, 255] : [20, 40, 90, 255],
  );
}

/** A frame of dense noise: near-incompressible, so the budget search has to work. */
function noisyFrame(width: number, height: number, seed: number): Uint8Array {
  const random = mulberry32(seed);
  return encodePNG(width, height, () => [
    Math.floor(random() * 256),
    Math.floor(random() * 256),
    Math.floor(random() * 256),
    255,
  ]);
}

interface Fixture {
  readonly base64: string;
  readonly frameCount: number;
  readonly frameRate: number;
}

async function harness(page: Page): Promise<void> {
  await page.goto('./harness.html');
  await expect(page.locator('#status')).toHaveText('ready');
}

/** Encode a set of PNG frames into a WebM the app can then treat as input. */
async function makeVideo(
  page: Page,
  frames: readonly Uint8Array[],
  frameRate: number,
): Promise<Fixture> {
  const base64Frames = frames.map((bytes) => Buffer.from(bytes).toString('base64'));
  const { base64 } = await page.evaluate(
    async ({ frames: f, frameRate: rate }) =>
      await window.__sticker!.encodeFixture({ frames: f, frameRate: rate, format: 'webm' }),
    { frames: base64Frames, frameRate },
  );
  return { base64, frameCount: frames.length, frameRate };
}

/** A two-second 12 fps clip of smooth, compressible content. */
async function simpleVideo(page: Page): Promise<Fixture> {
  const total = 24;
  const frames = Array.from({ length: total }, (_, i) => simpleFrame(320, 240, i, total));
  return await makeVideo(page, frames, 12);
}

/**
 * Three seconds of dense noise: too much for the budget at full frame rate on
 * any encoder measured, so the export has to degrade to fit and the test
 * exercises that path rather than passing on the first attempt.
 */
async function noisyVideo(page: Page): Promise<Fixture> {
  const total = 36;
  const frames = Array.from({ length: total }, (_, i) => noisyFrame(320, 240, i + 1));
  return await makeVideo(page, frames, 12);
}

type EncodeArgs = Parameters<NonNullable<Window['__sticker']>['encodeAnimated']>[0];

async function encode(page: Page, options: EncodeArgs) {
  return await page.evaluate(
    async (opts) => await window.__sticker!.encodeAnimated(opts),
    options,
  );
}

test('a video becomes a compliant Telegram video sticker', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  expect(result.issues).toEqual([]);
  expect(result.compliant).toBe(true);
  expect(result.withinBudget).toBe(true);

  const info = parseWebM(Buffer.from(result.base64, 'base64'));
  expect(info.video?.codecId).toBe('V_VP9');
  expect(info.hasAudio).toBe(false);
  expect(Math.max(info.video?.width ?? 0, info.video?.height ?? 0)).toBe(512);
});

test('a video becomes a compliant WhatsApp animated sticker', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
  });

  expect(result.issues).toEqual([]);

  const info = parseWebP(Buffer.from(result.base64, 'base64'));
  expect(info.isAnimated).toBe(true);
  expect(info.width).toBe(512);
  expect(info.height).toBe(512);
  expect(info.frameCount).toBeGreaterThan(1);
});

test('the produced bytes pass the same compliance check the app uses', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  for (const spec of [telegramVideo, whatsappAnimated]) {
    const result = await encode(page, {
      base64: fixture.base64,
      fileName: 'clip.webm',
      mimeType: 'video/webm',
      targetId: spec.id,
    });

    const report = checkCompliance(Buffer.from(result.base64, 'base64'), spec);
    expect(report.issues, `${spec.id}`).toEqual([]);
    expect(result.byteLength).toBeLessThanOrEqual(spec.maxBytes);
  }
});

test('Telegram keeps the source aspect ratio; WhatsApp is squared off', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const telegram = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });
  // 320x240 is 4:3, so the longest side is 512 and the other is 384.
  expect([telegram.width, telegram.height]).toEqual([512, 384]);

  const whatsapp = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
  });
  expect([whatsapp.width, whatsapp.height]).toEqual([512, 512]);
});

test('VP9 dimensions stay even, which the codec requires', async ({ page }) => {
  await harness(page);
  // 333x100 is 3.33:1, which scales to a height that would round to odd.
  const frames = Array.from({ length: 12 }, (_, i) => simpleFrame(333, 100, i, 12));
  const fixture = await makeVideo(page, frames, 12);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  expect(result.width % 2).toBe(0);
  expect(result.height % 2).toBe(0);
  expect(result.issues).toEqual([]);
});

test('the animation plays within three seconds however long the source is', async ({ page }) => {
  await harness(page);
  // Six seconds at 8 fps.
  const frames = Array.from({ length: 48 }, (_, i) => simpleFrame(320, 240, i, 48));
  const fixture = await makeVideo(page, frames, 8);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'long.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
  });

  const info = parseWebP(Buffer.from(result.base64, 'base64'));
  expect(info.durationMs).toBeLessThanOrEqual(3000 + 1);
  expect(result.issues).toEqual([]);
});

test('a long source is sampled across its whole length, not cut short', async ({ page }) => {
  await harness(page);

  // Eight seconds made of six distinct colour blocks. Which of them survive
  // into the sticker says exactly which part of the source was used.
  const palette = [
    [220, 30, 30],
    [30, 220, 30],
    [30, 30, 220],
    [220, 220, 30],
    [220, 30, 220],
    [30, 220, 220],
  ] as const;

  const perBlock = 8;
  const frames = palette.flatMap((colour) =>
    Array.from({ length: perBlock }, () =>
      encodePNG(320, 240, () => [colour[0], colour[1], colour[2], 255]),
    ),
  );
  const fixture = await makeVideo(page, frames, (palette.length * perBlock) / 8);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'long.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });
  expect(result.issues).toEqual([]);

  // Read the finished sticker back through the app's own extractor rather
  // than decoding the container by hand.
  const sampled = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 3000,
      frameRate: 12,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'sticker.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 256, height: 192 },
    });
  }, result.base64);

  const nearest = (pixel: readonly number[]) => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    palette.forEach((colour, index) => {
      const distance =
        ((pixel[0] as number) - colour[0]) ** 2 +
        ((pixel[1] as number) - colour[1]) ** 2 +
        ((pixel[2] as number) - colour[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return bestDistance <= 70 ** 2 ? best : -1;
  };

  const seen = sampled.centres.map(nearest).filter((index) => index >= 0);

  // The first and last blocks of the source both have to appear: the sticker
  // covers all eight seconds rather than the first three of them.
  expect(seen).toContain(0);
  expect(seen).toContain(palette.length - 1);
  expect(new Set(seen).size).toBeGreaterThanOrEqual(palette.length - 1);

  // And in order, since the clip is played faster rather than reordered.
  expect([...seen]).toEqual([...seen].sort((a, b) => a - b));
});

test('a trim window is honoured', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
    trimStartMs: 500,
    trimEndMs: 1500,
  });

  const info = parseWebP(Buffer.from(result.base64, 'base64'));
  // One second of animation, within the rounding the container allows.
  expect(info.durationMs).toBeGreaterThan(800);
  expect(info.durationMs).toBeLessThan(1200);
});

test('a requested frame rate is respected when it fits', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
    frameRate: 10,
  });

  expect(result.frameRate).toBe(10);
  expect(result.issues).toEqual([]);
});

test('the encoder reports the phases it went through', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  expect(result.phases).toEqual(['extracting', 'compositing', 'encoding']);
});

test('text is composited onto every frame', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const withText = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
    text: { text: 'HELLO', color: '#ff0000', fontSize: 0.2 },
  });

  const without = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'whatsapp-animated',
  });

  expect(withText.base64).not.toBe(without.base64);
  expect(withText.issues).toEqual([]);

  // Decode the animation's first frame back and look for the caption.
  const redPixels = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);

    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] as number) > 170 && (data[i + 1] as number) < 100 && (data[i + 2] as number) < 100) {
        count += 1;
      }
    }
    return count;
  }, withText.base64);

  expect(redPixels).toBeGreaterThan(200);
});

test('a source that resists compression is degraded as far as the ladder allows', async ({ page }) => {
  await harness(page);
  const fixture = await noisyVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'noise.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  // Dense noise is the pathological case: three seconds of it may be beyond
  // what VP9 can fit into 256 KB at any setting, and how far a given encoder
  // gets is its own business. What must hold everywhere is that the search
  // spent the ladder trying rather than giving up early.
  expect(result.ratesTried.length).toBeGreaterThan(1);
  expect(result.frameRate).toBeLessThan(30);
  expect(result.attempts).toBeGreaterThan(result.ratesTried.length);

  // Each rung must be slower than the last, so the search always makes
  // progress instead of re-measuring a rate it has already tried.
  expect([...result.ratesTried]).toEqual([...result.ratesTried].sort((a, b) => b - a));
  expect(new Set(result.ratesTried).size).toBe(result.ratesTried.length);
  expect(result.frameRate).toBe(result.ratesTried.at(-1));
});

test('a result that does not fit is reported as not fitting', async ({ page }) => {
  await harness(page);
  const fixture = await noisyVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'noise.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  // Whatever the encoder managed, what it says about the outcome has to match
  // the bytes. Silently handing back an oversized sticker is the failure mode
  // that matters: the platform would reject it and the user would not know why.
  const fits = result.byteLength <= telegramVideo.maxBytes;
  expect(result.withinBudget).toBe(fits);
  expect(result.compliant).toBe(fits);

  if (fits) {
    expect(result.issues).toEqual([]);
  } else {
    expect(result.issues.join(' ')).toMatch(/exceeds/);
  }
});

test('a compressible source of the same length fits comfortably', async ({ page }) => {
  // The counterpart to the noise case: ordinary video content, three seconds
  // of it, has to come in under budget and stay compliant.
  await harness(page);
  const frames = Array.from({ length: 36 }, (_, i) => simpleFrame(320, 240, i, 36));
  const fixture = await makeVideo(page, frames, 12);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  expect(result.byteLength).toBeLessThanOrEqual(telegramVideo.maxBytes);
  expect(result.withinBudget).toBe(true);
  expect(result.issues).toEqual([]);
});

test('the search spends as few encodes as it can', async ({ page }) => {
  await harness(page);
  const fixture = await simpleVideo(page);

  const result = await encode(page, {
    base64: fixture.base64,
    fileName: 'clip.webm',
    mimeType: 'video/webm',
    targetId: 'telegram-video',
  });

  // Binary search over a seven-rung ladder is at most three encodes per rate.
  expect(result.attempts).toBeLessThanOrEqual(3);
});
