import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { checkCompliance } from '../../src/core/compliance.ts';
import { STICKER_SPECS } from '../../src/core/specs.ts';
import { solid } from '../helpers/pngEncoder.ts';
import {
  BOTTOM_HALF,
  GREEN,
  RED,
  TOP_HALF,
  addText,
  clickCanvas,
  countPixels,
  download,
  dragOnCanvas,
  edit,
  setControl,
  upload,
} from './helpers/sticker.ts';

const telegramStatic = STICKER_SPECS['telegram-static'];
const whatsappStatic = STICKER_SPECS['whatsapp-static'];
const target = whatsappStatic.id;

/** A flat blue field, so any red or green in the export came from a text layer. */
const BACKDROP = () => solid(800, 800, [20, 40, 90, 255]);

async function makeRedText(page: Page, text: string): Promise<void> {
  await addText(page, text);
  await setControl(page, 'text-color', '#ff0000');
  await setControl(page, 'text-stroke-width', '0');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await upload(page, 'backdrop.png', BACKDROP());
});

test('the layer list starts empty and gains a layer when text is added', async ({ page }) => {
  await expect(page.getByTestId('layers-empty')).toBeVisible();

  await addText(page, 'HELLO');

  await expect(page.getByTestId('layer-list')).toBeVisible();
  await expect(page.getByTestId('layer-select-0')).toHaveText('HELLO');
});

test('added text is rendered into the exported sticker', async ({ page }) => {
  expect(await countPixels(page, target, RED)).toBe(0);

  await makeRedText(page, 'HELLO');

  expect(await countPixels(page, target, RED)).toBeGreaterThan(200);
});

test('text lands on both targets, and both stay compliant', async ({ page }) => {
  await makeRedText(page, 'HELLO');

  for (const spec of [telegramStatic, whatsappStatic]) {
    expect(await countPixels(page, spec.id, RED), `${spec.id} should contain red text`).toBeGreaterThan(100);
    expect(checkCompliance((await download(page, spec.id)).bytes, spec).issues).toEqual([]);
  }
});

test('text is drawn where the layer sits, and dragging moves it', async ({ page }) => {
  await makeRedText(page, 'HELLO');

  // The default caption sits near the bottom.
  expect(await countPixels(page, target, RED, BOTTOM_HALF)).toBeGreaterThan(200);
  expect(await countPixels(page, target, RED, TOP_HALF)).toBe(0);

  await dragOnCanvas(page, [0.5, 0.84], [0.5, 0.2]);

  expect(await countPixels(page, target, RED, TOP_HALF)).toBeGreaterThan(200);
  expect(await countPixels(page, target, RED, BOTTOM_HALF)).toBe(0);
});

test('clicking empty canvas deselects, and clicking text selects it again', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  await expect(page.getByTestId('text-controls')).toBeVisible();

  await clickCanvas(page, 0.5, 0.1);
  await expect(page.getByTestId('text-controls')).toHaveCount(0);

  await clickCanvas(page, 0.5, 0.84);
  await expect(page.getByTestId('text-controls')).toBeVisible();
});

test('the size control changes how much of the sticker the text covers', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  await setControl(page, 'text-size', '0.06');
  const small = await countPixels(page, target, RED);

  await setControl(page, 'text-size', '0.2');
  const large = await countPixels(page, target, RED);

  expect(large).toBeGreaterThan(small * 2);
});

test('the outline is drawn behind the fill, not over it', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  const withoutOutline = await countPixels(page, target, RED);

  await edit(page, async () => {
    await page.getByTestId('text-stroke-color').fill('#00ff00');
  });
  await setControl(page, 'text-stroke-width', '0.12');

  // A green outline must appear without swallowing the red fill.
  expect(await countPixels(page, target, GREEN)).toBeGreaterThan(200);
  expect(await countPixels(page, target, RED)).toBeGreaterThan(withoutOutline * 0.5);
});

test('opacity fades the text out of the export', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  expect(await countPixels(page, target, RED)).toBeGreaterThan(200);

  await setControl(page, 'text-opacity', '0');
  expect(await countPixels(page, target, RED)).toBe(0);
});

test('uppercase is applied to what is drawn, not just to the input', async ({ page }) => {
  await makeRedText(page, 'iii');
  const upper = await countPixels(page, target, RED);

  await edit(page, async () => {
    await page.getByTestId('text-uppercase').uncheck();
  });
  const lower = await countPixels(page, target, RED);

  // Lowercase "iii" has dots and short stems; uppercase "III" is solid bars.
  expect(upper).not.toBe(lower);
  await expect(page.getByTestId('text-content')).toHaveValue('iii');
});

test('newlines stack extra lines above the original', async ({ page }) => {
  // The default caption is a single line near the bottom, so this band sits
  // clear above it and is empty until further lines are added.
  const ABOVE = { x0: 0, y0: 0.55, x1: 1, y1: 0.72 } as const;

  await makeRedText(page, 'HELLO');
  const oneLine = await countPixels(page, target, RED);
  expect(await countPixels(page, target, RED, ABOVE)).toBe(0);

  await edit(page, async () => {
    await page.getByTestId('text-content').fill('HELLO\nHELLO\nHELLO');
  });

  expect(await countPixels(page, target, RED, ABOVE)).toBeGreaterThan(50);
  expect(await countPixels(page, target, RED)).toBeGreaterThan(oneLine * 2);
});

test('layers can be reordered, and the front layer wins the overlap', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  await edit(page, async () => {
    await page.getByTestId('add-text').click();
    await page.getByTestId('text-content').fill('HELLO');
  });
  await setControl(page, 'text-color', '#00ff00');
  await setControl(page, 'text-stroke-width', '0');

  // The copy is offset on creation; drag it back over the original.
  await dragOnCanvas(page, [0.54, 0.88], [0.5, 0.84]);

  const greenOnTop = await countPixels(page, target, GREEN);
  expect(greenOnTop).toBeGreaterThan(200);

  await edit(page, async () => {
    await page.getByTestId('layer-backward-1').click();
  });

  // With green sent behind red, less of it survives the overlap.
  expect(await countPixels(page, target, GREEN)).toBeLessThan(greenOnTop);
  expect(await countPixels(page, target, RED)).toBeGreaterThan(200);
});

test('a layer can be duplicated and deleted', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  const single = await countPixels(page, target, RED);

  await edit(page, async () => {
    await page.getByTestId('layer-duplicate-0').click();
  });
  await expect(page.getByTestId('layer-list').getByRole('listitem')).toHaveCount(2);
  expect(await countPixels(page, target, RED)).toBeGreaterThan(single);

  await edit(page, async () => {
    await page.getByTestId('layer-remove-0').click();
  });
  await edit(page, async () => {
    await page.getByTestId('layer-remove-0').click();
  });

  await expect(page.getByTestId('layers-empty')).toBeVisible();
  expect(await countPixels(page, target, RED)).toBe(0);
});

test('text survives a change of image', async ({ page }) => {
  await makeRedText(page, 'HELLO');
  await upload(page, 'second.png', solid(600, 900, [90, 20, 40, 255]));

  await expect(page.getByTestId('layer-select-0')).toHaveText('HELLO');
  expect(await countPixels(page, target, RED)).toBeGreaterThan(200);
});
