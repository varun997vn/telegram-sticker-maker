import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gradientWithAlpha } from '../helpers/pngEncoder.ts';
import { upload } from './helpers/sticker.ts';

/**
 * Layout and keyboard behaviour, checked against the real page rather than
 * against the stylesheet.
 */

const PHONE = { width: 360, height: 740 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Any element sticking out past the viewport, for a readable failure. */
async function overflowingElements(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders: string[] = [];

    for (const element of document.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.right > limit + 1) {
        const testId = element.getAttribute('data-testid');
        offenders.push(
          `${element.tagName.toLowerCase()}${testId ? `[${testId}]` : `.${element.className}`} right=${Math.round(rect.right)}`,
        );
      }
    }
    return offenders.slice(0, 8);
  });
}

for (const [label, viewport] of [
  ['a phone', PHONE],
  ['a tablet', TABLET],
  ['a desktop', DESKTOP],
] as const) {
  test(`the editor fits ${label} without scrolling sideways`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');
    await upload(page, 'photo.png', gradientWithAlpha(900, 600));

    await page.getByTestId('add-text').click();
    await expect(page.getByTestId('text-controls')).toBeVisible();

    expect(await overflowingElements(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test('the pack panel fits a phone once it holds stickers', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./');
  await upload(page, 'photo.png', gradientWithAlpha(900, 600));

  await page.getByTestId('add-to-pack-whatsapp-static').click();
  await expect(page.getByTestId('pack-count')).toHaveText('1');

  expect(await overflowingElements(page)).toEqual([]);
});

test('the example loads without a file of the user`s own', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('load-sample').click();

  await expect(page.getByTestId('source-info')).toContainText('example.png');
  await expect(page.getByTestId('status-whatsapp-static')).toHaveText(
    'Meets every requirement',
    { timeout: 30_000 },
  );
});

test('every control has an accessible name', async ({ page }) => {
  await page.goto('./');
  await upload(page, 'photo.png', gradientWithAlpha(900, 600));
  await page.getByTestId('add-text').click();

  const unnamed = await page.evaluate(() => {
    const offenders: string[] = [];

    for (const element of document.querySelectorAll('button, input, select, textarea, a[href]')) {
      const named =
        element.getAttribute('aria-label') ??
        element.getAttribute('title') ??
        (element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent : null) ??
        element.closest('label')?.textContent ??
        element.textContent;

      if (!named || named.trim().length === 0) {
        offenders.push(
          `${element.tagName.toLowerCase()}[${element.getAttribute('data-testid') ?? element.className}]`,
        );
      }
    }
    return offenders;
  });

  expect(unnamed).toEqual([]);
});

test('the layout canvas is reachable by keyboard and moves the selected layer', async ({ page }) => {
  await page.goto('./');
  await upload(page, 'photo.png', gradientWithAlpha(600, 600));

  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('text-controls')).toBeVisible();

  const canvas = page.getByTestId('design-canvas');
  await canvas.focus();
  await expect(canvas).toBeFocused();

  const before = await page.getByTestId('exports').getAttribute('data-export-key');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');

  // The export key carries the layer state, so it changing proves the nudge
  // reached the layer rather than only the canvas.
  await expect(page.getByTestId('exports')).not.toHaveAttribute(
    'data-export-key',
    before ?? '',
  );
});

test('shift makes an arrow nudge larger', async ({ page }) => {
  await page.goto('./');
  await upload(page, 'photo.png', gradientWithAlpha(600, 600));
  await page.getByTestId('add-text').click();

  const readY = async () => {
    const key = (await page.getByTestId('exports').getAttribute('data-export-key')) ?? '';
    return (JSON.parse(key.split('|').slice(2).join('|')) as { y: number }).y;
  };

  const start = await readY();
  await page.getByTestId('design-canvas').focus();
  await page.keyboard.press('ArrowDown');
  const small = await readY();

  await page.keyboard.press('Shift+ArrowDown');
  const large = await readY();

  expect(small - start).toBeCloseTo(0.01, 6);
  expect(large - small).toBeCloseTo(0.05, 6);
});

test('Escape clears the selection', async ({ page }) => {
  await page.goto('./');
  await upload(page, 'photo.png', gradientWithAlpha(600, 600));
  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('text-controls')).toBeVisible();

  await page.getByTestId('design-canvas').focus();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('text-controls')).toHaveCount(0);
});
