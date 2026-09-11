import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseWebM } from '../../src/core/formats/webm.ts';
import { parseWebP } from '../../src/core/formats/webp.ts';
import { encodePNG } from '../helpers/pngEncoder.ts';

/**
 * The frame pipeline, exercised against real ffmpeg.wasm in a real browser.
 *
 * The fixture video is built from PNG frames generated here, each a distinct
 * flat colour, so extraction can be checked frame by frame: if the frames come
 * back in the wrong order, at the wrong rate, or from the wrong part of the
 * source, the colour sequence says so immediately.
 */

const FIXTURE_COLOURS: readonly (readonly [number, number, number])[] = [
  [220, 30, 30],
  [30, 220, 30],
  [30, 30, 220],
  [220, 220, 30],
  [220, 30, 220],
  [30, 220, 220],
  [240, 240, 240],
  [20, 20, 20],
];

const FIXTURE_SIZE = { width: 160, height: 120 };
const FIXTURE_RATE = 8;

function flatFrame(colour: readonly [number, number, number]): string {
  const bytes = encodePNG(FIXTURE_SIZE.width, FIXTURE_SIZE.height, () => [
    colour[0],
    colour[1],
    colour[2],
    255,
  ]);
  return Buffer.from(bytes).toString('base64');
}

const FIXTURE_FRAMES = FIXTURE_COLOURS.map(flatFrame);

/** VP9 encoding in single-threaded wasm is slow; give the fixture room. */
test.describe.configure({ timeout: 180_000 });

async function harness(page: Page): Promise<void> {
  await page.goto('./harness.html');
  await expect(page.locator('#status')).toHaveText('ready');
}

/** Build the fixture once per test and hand back the encoded bytes. */
async function makeFixture(
  page: Page,
  format: 'webm' | 'webp' = 'webm',
): Promise<{ base64: string; byteLength: number }> {
  return await page.evaluate(
    async ({ frames, frameRate, format: fmt }) =>
      await window.__sticker!.encodeFixture({ frames, frameRate, format: fmt }),
    { frames: FIXTURE_FRAMES, frameRate: FIXTURE_RATE, format },
  );
}

/** Nearest fixture colour to a sampled pixel, as an index, or -1 if none is close. */
function colourIndex(pixel: readonly [number, number, number, number]): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  FIXTURE_COLOURS.forEach((colour, index) => {
    const distance =
      (pixel[0] - colour[0]) ** 2 + (pixel[1] - colour[1]) ** 2 + (pixel[2] - colour[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });

  // Lossy VP9 shifts flat colours a little, but nowhere near to another of
  // these deliberately well-separated choices.
  return bestDistance <= 60 ** 2 ? best : -1;
}

test('the ffmpeg core is served from our own origin, not a CDN', async ({ page }) => {
  await harness(page);

  const urls = await page.evaluate(() => window.__sticker!.coreUrls());
  const origin = new URL(page.url()).origin;

  expect(new URL(urls.coreURL, page.url()).origin).toBe(origin);
  expect(new URL(urls.wasmURL, page.url()).origin).toBe(origin);
});

test('the core loads, reports download progress, and is reused', async ({ page }) => {
  await harness(page);

  expect(await page.evaluate(() => window.__sticker!.isLoaded())).toBe(false);

  const { loadedBytes } = await page.evaluate(async () => await window.__sticker!.load());
  expect(loadedBytes).toBeGreaterThan(1_000_000);
  expect(await page.evaluate(() => window.__sticker!.isLoaded())).toBe(true);

  // A second call must reuse the instance rather than downloading again.
  const again = await page.evaluate(async () => {
    const before = performance.now();
    await window.__sticker!.load();
    return performance.now() - before;
  });
  expect(again).toBeLessThan(500);
});

test('a VP9 fixture encodes to a real, parseable WebM', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const info = parseWebM(Buffer.from(fixture.base64, 'base64'));
  expect(info.video?.codecId).toBe('V_VP9');
  expect(info.video?.width).toBe(FIXTURE_SIZE.width);
  expect(info.video?.height).toBe(FIXTURE_SIZE.height);
  expect(info.videoFrameCount).toBe(FIXTURE_COLOURS.length);
  expect(info.hasAudio).toBe(false);
});

test('the browser can probe the fixture the way it probes a user file', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const probed = await page.evaluate(
    async (base64) =>
      await window.__sticker!.probe({ base64, fileName: 'fixture.webm', mimeType: 'video/webm' }),
    fixture.base64,
  );

  expect(probed.width).toBe(FIXTURE_SIZE.width);
  expect(probed.height).toBe(FIXTURE_SIZE.height);
  // Eight frames at 8 fps is one second.
  expect(probed.durationMs).toBeGreaterThan(800);
  expect(probed.durationMs).toBeLessThan(1200);
});

test('extraction returns frames at the planned size and count', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      frameRate: 8,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 64, height: 48 },
    });
  }, fixture.base64);

  expect(result.frameCount).toBe(8);
  expect(result.width).toBe(64);
  expect(result.height).toBe(48);
  expect(result.stages).toEqual(['reading', 'extracting', 'decoding']);
});

test('extracted frames arrive in source order', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      frameRate: 8,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 64, height: 48 },
    });
  }, fixture.base64);

  expect(result.centres.map((pixel) => colourIndex(pixel))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('a trim window extracts from the right part of the source', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    // Frames 5 to 8 of an 8 fps second: 500 ms in, half a second long.
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      trimStartMs: 500,
      trimEndMs: 1000,
      frameRate: 8,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 64, height: 48 },
    });
  }, fixture.base64);

  expect(result.frameCount).toBe(4);
  expect(result.centres.map((pixel) => colourIndex(pixel))).toEqual([4, 5, 6, 7]);
});

test('a lower planned frame rate drops frames evenly rather than truncating', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      frameRate: 4,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 64, height: 48 },
    });
  }, fixture.base64);

  expect(result.frameCount).toBe(4);

  // Halving the rate must sample across the whole clip, not just its start.
  const indices = result.centres.map((pixel) => colourIndex(pixel));
  expect(indices[0]).toBeLessThanOrEqual(1);
  expect(indices.at(-1)).toBeGreaterThanOrEqual(5);
  expect([...indices]).toEqual([...indices].sort((a, b) => a - b));
});

test('padding keeps the aspect ratio and fills the rest with transparency', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      frameRate: 2,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    // A 4:3 source into a square box has to be padded, not stretched.
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 128, height: 128 },
      pad: true,
    });
  }, fixture.base64);

  expect(result.width).toBe(128);
  expect(result.height).toBe(128);
  // The centre of a padded frame is still image, not padding.
  expect(result.centres[0]?.[3]).toBe(255);
});

test('cropping selects a region of the source', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      frameRate: 2,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 64, height: 64 },
      crop: { x: 20, y: 0, width: 120, height: 120 },
    });
  }, fixture.base64);

  expect(result.width).toBe(64);
  expect(result.height).toBe(64);
  expect(result.frameCount).toBe(2);
});

test('an animated WebP fixture encodes and parses', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page, 'webp');

  const info = parseWebP(Buffer.from(fixture.base64, 'base64'));
  expect(info.isAnimated).toBe(true);
  expect(info.frameCount).toBe(FIXTURE_COLOURS.length);
  expect(info.width).toBe(FIXTURE_SIZE.width);
  expect(info.height).toBe(FIXTURE_SIZE.height);
});

test('the fixture WebM this app muxes is decodable by ffmpeg', async ({ page }) => {
  // The app writes its own WebM container, because ffmpeg cannot encode VP9
  // here. ffmpeg reading that container back is the check that it is correct.
  await harness(page);
  const fixture = await makeFixture(page);

  const result = await page.evaluate(async (base64) => {
    const plan = window.__sticker!.planFrames({
      sourceDurationMs: 1000,
      frameRate: 8,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    return await window.__sticker!.extract({
      base64,
      fileName: 'fixture.webm',
      mimeType: 'video/webm',
      plan,
      size: { width: 64, height: 48 },
    });
  }, fixture.base64);

  expect(result.frameCount).toBe(FIXTURE_COLOURS.length);
});

test('a file that is not a video fails with a readable message', async ({ page }) => {
  await harness(page);

  const message = await page.evaluate(async () => {
    const bytes = new Uint8Array(64).fill(7);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);

    try {
      await window.__sticker!.probe({
        base64: btoa(binary),
        fileName: 'broken.webm',
        mimeType: 'video/webm',
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  expect(message).toContain('broken.webm');
});

test('temporary files do not accumulate across runs', async ({ page }) => {
  await harness(page);
  const fixture = await makeFixture(page);

  // Three extractions in a row must not trip over each other's frame files.
  for (let run = 0; run < 3; run += 1) {
    const result = await page.evaluate(async (base64) => {
      const plan = window.__sticker!.planFrames({
        sourceDurationMs: 1000,
        frameRate: 8,
        maxDurationMs: 3000,
        maxFrameRate: 30,
      });
      return await window.__sticker!.extract({
        base64,
        fileName: 'fixture.webm',
        mimeType: 'video/webm',
        plan,
        size: { width: 64, height: 48 },
      });
    }, fixture.base64);

    expect(result.frameCount, `run ${run + 1} should extract 8 frames`).toBe(8);
    expect(result.centres.map((pixel) => colourIndex(pixel))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  }
});
