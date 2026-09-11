import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { checkCompliance } from '../../src/core/compliance.ts';
import { parseWebM } from '../../src/core/formats/webm.ts';
import { parseWebP } from '../../src/core/formats/webp.ts';
import { STICKER_SPECS } from '../../src/core/specs.ts';
import { encodePNG } from '../helpers/pngEncoder.ts';

/**
 * The video workflow through the real interface: drop in a video, caption it,
 * generate, download, and check the saved bytes against the platform rules.
 */

const telegramVideo = STICKER_SPECS['telegram-video'];
const whatsappAnimated = STICKER_SPECS['whatsapp-animated'];

test.describe.configure({ timeout: 300_000 });

function movingBand(width: number, height: number, index: number, total: number): Uint8Array {
  const band = (index / total) * height;
  return encodePNG(width, height, (_x, y) =>
    Math.abs(y - band) < height / 6 ? [240, 120, 40, 255] : [20, 40, 90, 255],
  );
}

/**
 * Build a WebM in the harness page, then hand it to the app as a file. The
 * app's own encoder makes it, which the ffmpeg decode during extraction then
 * validates.
 */
async function makeVideoFile(page: Page, frames: number, frameRate: number): Promise<Buffer> {
  const pngs = Array.from({ length: frames }, (_, i) =>
    Buffer.from(movingBand(240, 180, i, frames)).toString('base64'),
  );

  await page.goto('./harness.html');
  await expect(page.locator('#status')).toHaveText('ready');

  const { base64 } = await page.evaluate(
    async ({ f, rate }) =>
      await window.__sticker!.encodeFixture({ frames: f, frameRate: rate, format: 'webm' }),
    { f: pngs, rate: frameRate },
  );

  return Buffer.from(base64, 'base64');
}

async function openWith(page: Page, video: Buffer): Promise<void> {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: video,
  });
  await expect(page.getByTestId('source-info')).toContainText('clip.webm');
  await expect(page.getByTestId('trim-controls')).toBeVisible();
}

async function generate(page: Page, targetId: string): Promise<void> {
  await page.getByTestId(`generate-${targetId}`).click();
  await expect(page.getByTestId(`status-${targetId}`)).toHaveText('Meets every requirement', {
    timeout: 180_000,
  });
}

async function download(page: Page, targetId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const [event] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(`download-${targetId}`).click(),
  ]);

  const path = await event.path();
  if (!path) throw new Error(`Download for ${targetId} produced no file`);
  return { bytes: new Uint8Array(await readFile(path)), fileName: event.suggestedFilename() };
}

test('a dropped video offers the animated targets, not the still ones', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);

  await expect(page.getByTestId(`export-${telegramVideo.id}`)).toBeVisible();
  await expect(page.getByTestId(`export-${whatsappAnimated.id}`)).toBeVisible();
  await expect(page.getByTestId('export-telegram-static')).toHaveCount(0);
});

test('the source line reports the video duration', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);

  // Sixteen frames at 8 fps is two seconds.
  await expect(page.getByTestId('source-info')).toContainText('2.0s');
});

test('nothing is generated until asked for', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);

  await expect(page.getByTestId(`status-${telegramVideo.id}`)).toHaveText('Ready to generate');
  await expect(page.getByTestId(`size-${telegramVideo.id}`)).toHaveText('—');
  await expect(page.getByTestId(`download-${telegramVideo.id}`)).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('generating produces a downloadable, compliant Telegram video sticker', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);
  await generate(page, telegramVideo.id);

  const { bytes, fileName } = await download(page, telegramVideo.id);
  expect(fileName).toBe(`clip-${telegramVideo.id}.webm`);

  const report = checkCompliance(bytes, telegramVideo);
  expect(report.issues).toEqual([]);

  const info = parseWebM(bytes);
  expect(info.video?.codecId).toBe('V_VP9');
  expect(info.hasAudio).toBe(false);
});

test('generating produces a downloadable, compliant WhatsApp animated sticker', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);
  await generate(page, whatsappAnimated.id);

  const { bytes, fileName } = await download(page, whatsappAnimated.id);
  expect(fileName).toBe(`clip-${whatsappAnimated.id}.webp`);

  expect(checkCompliance(bytes, whatsappAnimated).issues).toEqual([]);
  const info = parseWebP(bytes);
  expect(info.isAnimated).toBe(true);
  expect([info.width, info.height]).toEqual([512, 512]);
});

test('the result is previewed in the card once it exists', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);
  await generate(page, whatsappAnimated.id);

  await expect(page.getByTestId(`result-${whatsappAnimated.id}`)).toBeVisible();
});

test('the card reports the frames and rate it settled on', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);
  await generate(page, telegramVideo.id);

  await expect(page.getByTestId(`frames-${telegramVideo.id}`)).toContainText('fps');
  await expect(page.getByTestId(`dimensions-${telegramVideo.id}`)).toHaveText('512x384');
});

test('a caption added in the editor reaches the animated export', async ({ page }) => {
  const video = await makeVideoFile(page, 16, 8);
  await openWith(page, video);

  await page.getByTestId('add-text').click();
  await page.getByTestId('text-content').fill('HELLO');
  await page.getByTestId('text-color').fill('#ff0000');
  await page.getByTestId('text-size').fill('0.2');

  await generate(page, whatsappAnimated.id);
  const { bytes } = await download(page, whatsappAnimated.id);

  const redPixels = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/webp' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);

    const { data: pixels } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if ((pixels[i] as number) > 170 && (pixels[i + 1] as number) < 100 && (pixels[i + 2] as number) < 100) {
        count += 1;
      }
    }
    return count;
  }, Array.from(bytes));

  expect(redPixels).toBeGreaterThan(200);
});

test('trimming the clip shortens the exported animation', async ({ page }) => {
  const video = await makeVideoFile(page, 24, 12);
  await openWith(page, video);

  await page.getByTestId('trim-end').fill('700');
  await expect(page.getByTestId('trim-end-value')).toHaveText('0.70s');

  await generate(page, whatsappAnimated.id);
  const { bytes } = await download(page, whatsappAnimated.id);

  const info = parseWebP(bytes);
  expect(info.durationMs).toBeLessThan(900);
  expect(info.durationMs).toBeGreaterThan(500);
});

test('choosing a lower frame rate is honoured', async ({ page }) => {
  const video = await makeVideoFile(page, 24, 12);
  await openWith(page, video);

  await page.getByTestId('frame-rate').selectOption('10');
  await generate(page, telegramVideo.id);

  await expect(page.getByTestId(`frames-${telegramVideo.id}`)).toContainText('10fps');
});

test('a long source is clipped to the three second limit, and says so', async ({ page }) => {
  // Five seconds at 8 fps.
  const video = await makeVideoFile(page, 40, 8);
  await openWith(page, video);

  await page.getByTestId('trim-end').fill('5000');
  await expect(page.getByTestId('clip-summary')).toContainText('3.00s');
  await expect(page.getByTestId('clip-summary')).toContainText('the limit is');
});

test('a still image still offers the still targets', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(movingBand(600, 400, 1, 4)),
  });

  await expect(page.getByTestId('export-telegram-static')).toBeVisible();
  await expect(page.getByTestId(`export-${telegramVideo.id}`)).toHaveCount(0);
  await expect(page.getByTestId('trim-controls')).toHaveCount(0);
});
