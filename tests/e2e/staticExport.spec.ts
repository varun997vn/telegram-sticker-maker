import { expect, test } from '@playwright/test';
import { checkCompliance } from '../../src/core/compliance.ts';
import { parseWebP } from '../../src/core/formats/webp.ts';
import { STICKER_SPECS } from '../../src/core/specs.ts';
import { gradientWithAlpha, noise, quadrants } from '../helpers/pngEncoder.ts';
import { download, edit, settle, upload } from './helpers/sticker.ts';

const telegramStatic = STICKER_SPECS['telegram-static'];
const whatsappStatic = STICKER_SPECS['whatsapp-static'];

async function chooseFit(page: import('@playwright/test').Page, mode: 'contain' | 'cover'): Promise<void> {
  await edit(page, async () => {
    await page.getByTestId(`fit-${mode}`).check();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('an uploaded image becomes a compliant sticker for both still targets', async ({ page }) => {
  await upload(page, 'holiday photo.png', gradientWithAlpha(900, 600));

  for (const spec of [telegramStatic, whatsappStatic]) {
    const { bytes, fileName } = await download(page, spec.id);

    const report = checkCompliance(bytes, spec);
    expect(report.issues, `${spec.id} should have no compliance issues`).toEqual([]);
    expect(fileName).toBe(`holiday-photo-${spec.id}.webp`);
  }
});

test('Telegram keeps the source aspect ratio and WhatsApp gets a square', async ({ page }) => {
  await upload(page, 'wide.png', gradientWithAlpha(900, 600));

  // 900x600 scaled so the longest side is exactly 512 gives 512x341.
  await expect(page.getByTestId(`dimensions-${telegramStatic.id}`)).toHaveText('512x341');
  await expect(page.getByTestId(`dimensions-${whatsappStatic.id}`)).toHaveText('512x512');

  const telegram = parseWebP((await download(page, telegramStatic.id)).bytes);
  expect([telegram.width, telegram.height]).toEqual([512, 341]);

  const whatsapp = parseWebP((await download(page, whatsappStatic.id)).bytes);
  expect([whatsapp.width, whatsapp.height]).toEqual([512, 512]);
});

test('transparency survives the round trip', async ({ page }) => {
  await upload(page, 'disc.png', gradientWithAlpha(600, 600));

  const { bytes } = await download(page, whatsappStatic.id);
  expect(parseWebP(bytes).hasAlpha).toBe(true);
});

test('the reported size is the size of the file that downloads', async ({ page }) => {
  await upload(page, 'photo.png', gradientWithAlpha(1200, 800));

  for (const spec of [telegramStatic, whatsappStatic]) {
    const shown = await page.getByTestId(`size-${spec.id}`).textContent();
    const { bytes } = await download(page, spec.id);

    // The card shows kilobytes to one decimal; compare at that precision.
    const expected = bytes.byteLength < 1000
      ? `${bytes.byteLength} B`
      : `${(bytes.byteLength / 1000).toFixed(bytes.byteLength / 1000 < 10 ? 1 : 0)} KB`;
    expect(shown).toBe(expected);
  }
});

test('a hard-to-compress image is reported honestly, whatever the outcome', async ({ page }) => {
  // Dense noise may or may not fit WhatsApp's 100 KB budget depending on the
  // browser's encoder. What must always hold is that the status the card shows
  // matches what the downloaded bytes actually are.
  await upload(page, 'noise.png', noise(900, 900));

  const { bytes } = await download(page, whatsappStatic.id);
  const report = checkCompliance(bytes, whatsappStatic);
  const status = await page.getByTestId(`status-${whatsappStatic.id}`).textContent();

  if (report.ok) {
    expect(status).toBe('Meets every requirement');
    expect(bytes.byteLength).toBeLessThanOrEqual(whatsappStatic.maxBytes);
  } else {
    expect(status).toBe(report.issues[0]?.message);
  }
});

test('the quality search trades quality away only when it has to', async ({ page }) => {
  // A smooth gradient fits WhatsApp's 100 KB budget at top quality; dense noise
  // cannot, so the search has to step down for it. Comparing the two is far
  // more robust than asserting a quality number the browser's encoder picks.
  await upload(page, 'gradient.png', gradientWithAlpha(900, 900));
  const easy = Number(await page.getByTestId(`quality-${whatsappStatic.id}`).textContent());

  await upload(page, 'noise.png', noise(900, 900));
  const hard = Number(await page.getByTestId(`quality-${whatsappStatic.id}`).textContent());

  expect(easy).toBe(95);
  expect(hard).toBeLessThan(easy);

  const { bytes } = await download(page, whatsappStatic.id);
  expect(bytes.byteLength).toBeLessThanOrEqual(whatsappStatic.maxBytes);
});

test('switching to fill-and-crop re-encodes and changes the result', async ({ page }) => {
  await upload(page, 'wide.png', quadrants(1200, 400));

  const contained = (await download(page, whatsappStatic.id)).bytes;

  await chooseFit(page, 'cover');
  const covered = (await download(page, whatsappStatic.id)).bytes;

  // Both stay square and compliant, but a letterboxed image and a cropped one
  // are not the same picture.
  expect(parseWebP(contained).width).toBe(512);
  expect(parseWebP(covered).width).toBe(512);
  expect(Buffer.from(covered).equals(Buffer.from(contained))).toBe(false);
});

test('replacing the image updates every export', async ({ page }) => {
  await upload(page, 'first.png', gradientWithAlpha(900, 600));
  await expect(page.getByTestId(`dimensions-${telegramStatic.id}`)).toHaveText('512x341');

  await upload(page, 'second.png', gradientWithAlpha(600, 900));
  await expect(page.getByTestId(`dimensions-${telegramStatic.id}`)).toHaveText('341x512');
  expect((await download(page, telegramStatic.id)).fileName).toBe(`second-${telegramStatic.id}.webp`);
});

test('an unsupported file is rejected with a readable message', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not an image'),
  });

  await expect(page.getByTestId('error')).toBeVisible();
  await expect(page.getByTestId('error')).toContainText('notes.txt');
  await expect(page.getByTestId('exports')).toHaveCount(0);
});

test('a dropped file is accepted, not just a picked one', async ({ page }) => {
  const bytes = gradientWithAlpha(600, 600);
  const base64 = Buffer.from(bytes).toString('base64');

  await page.getByTestId('dropzone').evaluate(async (element, encoded) => {
    const binary = atob(encoded);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);

    const transfer = new DataTransfer();
    transfer.items.add(new File([buffer], 'dropped.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }, base64);

  await expect(page.getByTestId('source-info')).toContainText('dropped.png');
  await settle(page, '');
  expect(checkCompliance((await download(page, whatsappStatic.id)).bytes, whatsappStatic).ok).toBe(true);
});
