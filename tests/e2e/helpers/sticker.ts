import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export const STATIC_TARGETS = ['telegram-static', 'whatsapp-static'] as const;

/**
 * The exports section is tagged with the settings that produced it. Waiting for
 * that tag to change before waiting for the encodes to settle is what stops a
 * test from reading the previous state's results and believing them.
 */
export async function exportKey(page: Page): Promise<string> {
  const section = page.getByTestId('exports');
  return (await section.count()) === 0
    ? ''
    : ((await section.getAttribute('data-export-key')) ?? '');
}

export async function settle(page: Page, previousKey: string): Promise<void> {
  await expect(page.getByTestId('exports')).not.toHaveAttribute('data-export-key', previousKey);
  for (const id of STATIC_TARGETS) {
    await expect(page.getByTestId(`status-${id}`)).not.toHaveText('Encoding…');
  }
}

/** Runs an edit and waits for every export to catch up with it. */
export async function edit(page: Page, action: () => Promise<void>): Promise<void> {
  const previousKey = await exportKey(page);
  await action();
  await settle(page, previousKey);
}

export async function upload(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  await edit(page, async () => {
    await page.getByTestId('file-input').setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
    await expect(page.getByTestId('source-info')).toContainText(name);
  });
}

/** Click a download link and return the bytes the browser actually saved. */
export async function download(
  page: Page,
  targetId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const [event] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(`download-${targetId}`).click(),
  ]);

  const path = await event.path();
  if (!path) throw new Error(`Download for ${targetId} produced no file`);

  return { bytes: new Uint8Array(await readFile(path)), fileName: event.suggestedFilename() };
}

export interface Region {
  /** Fractions of the image, 0 to 1. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const WHOLE_IMAGE: Region = { x0: 0, y0: 0, x1: 1, y1: 1 };
export const TOP_HALF: Region = { x0: 0, y0: 0, x1: 1, y1: 0.5 };
export const BOTTOM_HALF: Region = { x0: 0, y0: 0.5, x1: 1, y1: 1 };

export interface ColourTest {
  /** Channel ranges a pixel must fall inside to be counted. */
  readonly r: readonly [number, number];
  readonly g: readonly [number, number];
  readonly b: readonly [number, number];
}

/** Strong primaries, with enough slack for a lossy WebP round trip. */
export const RED: ColourTest = { r: [170, 255], g: [0, 100], b: [0, 100] };
export const GREEN: ColourTest = { r: [0, 100], g: [170, 255], b: [0, 100] };

/**
 * Decode an exported sticker back into pixels and count matches.
 *
 * Asserting on the produced image is the only way to know a text layer really
 * rendered where it was asked to; the encoder settings say nothing about that.
 */
export async function countPixels(
  page: Page,
  targetId: string,
  colour: ColourTest,
  region: Region = WHOLE_IMAGE,
): Promise<number> {
  return await page.evaluate(
    async ({ targetId: id, colour: test, region: box }) => {
      const anchor = document.querySelector<HTMLAnchorElement>(`[data-testid="download-${id}"]`);
      const href = anchor?.getAttribute('href');
      if (!href) throw new Error(`No download URL for ${id}`);

      const blob = await (await fetch(href)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D context available');
      context.drawImage(bitmap, 0, 0);

      const x = Math.floor(box.x0 * bitmap.width);
      const y = Math.floor(box.y0 * bitmap.height);
      const width = Math.max(1, Math.ceil((box.x1 - box.x0) * bitmap.width));
      const height = Math.max(1, Math.ceil((box.y1 - box.y0) * bitmap.height));
      const { data } = context.getImageData(x, y, width, height);

      let matching = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        const a = data[i + 3] as number;
        if (a < 128) continue;
        if (
          r >= test.r[0] && r <= test.r[1] &&
          g >= test.g[0] && g <= test.g[1] &&
          b >= test.b[0] && b <= test.b[1]
        ) {
          matching += 1;
        }
      }
      return matching;
    },
    { targetId, colour, region },
  );
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Map normalised canvas positions to viewport coordinates for `page.mouse`.
 *
 * The canvas is scrolled into view first: `boundingBox` and `page.mouse` both
 * work in viewport coordinates, so a canvas that earlier interactions have
 * pushed off the top yields points with negative coordinates, and every
 * synthesised click there silently misses. Each resulting point is checked,
 * so a miss fails loudly instead of looking like broken hit testing.
 */
async function canvasPoints(page: Page, positions: readonly (readonly [number, number])[]): Promise<Point[]> {
  const canvas = page.getByTestId('design-canvas');
  await canvas.scrollIntoViewIfNeeded();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Design canvas is not laid out');

  const viewport = page.viewportSize();
  return positions.map(([x, y]) => {
    const point = { x: box.x + box.width * x, y: box.y + box.height * y };
    const outside =
      point.x < 0 ||
      point.y < 0 ||
      (viewport !== null && (point.x > viewport.width || point.y > viewport.height));

    if (outside) {
      throw new Error(
        `Canvas position ${x},${y} maps to ${point.x},${point.y}, which is outside the viewport`,
      );
    }
    return point;
  });
}

/** Click the design canvas at a normalised position. */
export async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  const [point] = await canvasPoints(page, [[x, y]]);
  await page.mouse.click(point!.x, point!.y);
}

/** Drag on the design canvas between two normalised positions. */
export async function dragOnCanvas(
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  const [start, end] = await canvasPoints(page, [from, to]);

  await edit(page, async () => {
    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    await page.mouse.move(end!.x, end!.y, { steps: 12 });
    await page.mouse.up();
  });
}

/**
 * How far down the sticker the first matching pixel appears, as a fraction of
 * its height, or 1 when there is none.
 *
 * Measuring where the text is beats counting pixels inside a fixed band: the
 * band has to be picked from assumed font metrics, and a different font or a
 * little antialiasing noise moves the count without changing the behaviour
 * under test.
 */
export async function topmostRow(
  page: Page,
  targetId: string,
  colour: ColourTest,
): Promise<number> {
  return await page.evaluate(
    async ({ targetId: id, colour: test }) => {
      const anchor = document.querySelector<HTMLAnchorElement>(`[data-testid="download-${id}"]`);
      const href = anchor?.getAttribute('href');
      if (!href) throw new Error(`No download URL for ${id}`);

      const blob = await (await fetch(href)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D context available');
      context.drawImage(bitmap, 0, 0);

      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);

      for (let y = 0; y < bitmap.height; y += 1) {
        // A handful of matching pixels in a row, so a stray artefact from the
        // lossy encode does not register as the top of the text.
        let inRow = 0;
        for (let x = 0; x < bitmap.width; x += 1) {
          const i = (y * bitmap.width + x) * 4;
          const r = data[i] as number;
          const g = data[i + 1] as number;
          const b = data[i + 2] as number;
          const a = data[i + 3] as number;
          if (
            a >= 128 &&
            r >= test.r[0] && r <= test.r[1] &&
            g >= test.g[0] && g <= test.g[1] &&
            b >= test.b[0] && b <= test.b[1]
          ) {
            inRow += 1;
            if (inRow >= 3) return y / bitmap.height;
          }
        }
      }
      return 1;
    },
    { targetId, colour },
  );
}

/** Add a text layer and wait for the exports to reflect it. */
export async function addText(page: Page, text: string): Promise<void> {
  await edit(page, async () => {
    await page.getByTestId('add-text').click();
    await page.getByTestId('text-content').fill(text);
  });
}

export async function setControl(page: Page, testId: string, value: string): Promise<void> {
  await edit(page, async () => {
    await page.getByTestId(testId).fill(value);
  });
}
