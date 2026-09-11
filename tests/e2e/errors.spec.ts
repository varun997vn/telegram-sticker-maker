import { expect, test } from '@playwright/test';
import { encodePNG, gradientWithAlpha } from '../helpers/pngEncoder.ts';

/**
 * What the app does when something is wrong with the input or the browser.
 * A failure the user cannot act on is barely better than a crash.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('a capable browser is not warned about anything', async ({ page }) => {
  // The capability probe has to be right in the ordinary case too: reporting
  // a missing encoder that is present disables exports that would have worked.
  await expect(page.getByTestId('capability-warning')).toHaveCount(0);

  const detected = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(2, 2);
    canvas.getContext('2d');
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    return blob.type;
  });
  expect(detected).toBe('image/webp');
});

test('a file that is not media at all is refused by name', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a sticker'),
  });

  await expect(page.getByTestId('error')).toContainText('notes.txt');
  await expect(page.getByTestId('exports')).toHaveCount(0);
});

test('a video the browser cannot decode says so, naming the file', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(new Uint8Array(256).fill(9)),
  });

  await expect(page.getByTestId('error')).toContainText('broken.webm');
  await expect(page.getByTestId('trim-controls')).toHaveCount(0);
});

test('an image with a valid name but corrupt bytes is refused', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'corrupt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(new Uint8Array(64).fill(3)),
  });

  await expect(page.getByTestId('error')).toContainText('corrupt.png');
});

test('a failed load does not discard the sticker already being edited', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'good.png',
    mimeType: 'image/png',
    buffer: Buffer.from(gradientWithAlpha(600, 600)),
  });
  await expect(page.getByTestId('source-info')).toContainText('good.png');

  await page.getByTestId('file-input').setInputFiles({
    name: 'bad.png',
    mimeType: 'image/png',
    buffer: Buffer.from(new Uint8Array(64).fill(3)),
  });

  await expect(page.getByTestId('error')).toBeVisible();
  // The working image must survive a failed attempt to replace it.
  await expect(page.getByTestId('source-info')).toContainText('good.png');
  await expect(page.getByTestId('status-whatsapp-static')).toHaveText('Meets every requirement');
});

test('a later success clears an earlier error', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('nope'),
  });
  await expect(page.getByTestId('error')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles({
    name: 'good.png',
    mimeType: 'image/png',
    buffer: Buffer.from(gradientWithAlpha(600, 600)),
  });

  await expect(page.getByTestId('error')).toHaveCount(0);
  await expect(page.getByTestId('source-info')).toContainText('good.png');
});

test('a browser without WebCodecs disables the Telegram video export and says why', async ({ page }) => {
  // Build the fixture while the encoder is still present, then take it away
  // before the app loads, which is the situation a Safari user is in.
  await page.goto('./harness.html');
  await expect(page.locator('#status')).toHaveText('ready');

  const frames = Array.from({ length: 8 }, (_, i) =>
    Buffer.from(
      encodePNG(160, 120, (_x, y) => (Math.abs(y - i * 15) < 20 ? [240, 80, 40, 255] : [20, 40, 90, 255])),
    ).toString('base64'),
  );

  const { base64 } = await page.evaluate(
    async (f) => await window.__sticker!.encodeFixture({ frames: f, frameRate: 8, format: 'webm' }),
    frames,
  );

  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'VideoEncoder');
  });
  await page.goto('./');

  await page.getByTestId('file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(base64, 'base64'),
  });
  await expect(page.getByTestId('source-info')).toContainText('clip.webm');

  // The Telegram card explains itself rather than waiting to fail.
  await expect(page.getByTestId('status-telegram-video')).toContainText('WebCodecs', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('generate-telegram-video')).toBeDisabled();

  // WhatsApp's animated export does not use WebCodecs, so it stays available.
  await expect(page.getByTestId('generate-whatsapp-animated')).toBeEnabled();
  await expect(page.getByTestId('status-whatsapp-animated')).toHaveText('Ready to generate');
});
