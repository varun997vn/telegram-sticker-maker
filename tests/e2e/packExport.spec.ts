import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { checkCompliance } from '../../src/core/compliance.ts';
import { parsePNG } from '../../src/core/formats/png.ts';
import { STICKER_SPECS } from '../../src/core/specs.ts';
import { gradientWithAlpha, quadrants, solid } from '../helpers/pngEncoder.ts';
import { upload } from './helpers/sticker.ts';

/**
 * Pack export through the real interface, checked by extracting the downloaded
 * archive with the system `unzip` and reading what is inside it.
 */

const whatsappStatic = STICKER_SPECS['whatsapp-static'];
const telegramStatic = STICKER_SPECS['telegram-static'];

let workDir: string;

test.beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'sticker-pack-e2e-'));
});

test.afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function addOne(page: Page, name: string, bytes: Uint8Array, targetId: string): Promise<void> {
  await upload(page, name, bytes);

  // Adding to the pack does not change the export key, so wait on the pack
  // itself rather than on the export cards.
  const before = Number((await page.getByTestId('pack-count').textContent()) ?? '0');
  await page.getByTestId(`add-to-pack-${targetId}`).click();
  await expect(page.getByTestId('pack-count')).toHaveText(String(before + 1));
}

async function downloadPack(page: Page, label: string): Promise<string> {
  await page.getByTestId('build-pack').click();
  await expect(page.getByTestId('download-pack')).toBeVisible({ timeout: 60_000 });

  const [event] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-pack').click(),
  ]);

  const source = await event.path();
  if (!source) throw new Error('Pack download produced no file');

  const archive = join(workDir, `${label}.zip`);
  const target = join(workDir, label);
  writeFileSync(archive, readFileSync(source));
  execFileSync('unzip', ['-qq', '-o', archive, '-d', target]);
  return target;
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('the pack starts empty and cannot be built', async ({ page }) => {
  await expect(page.getByTestId('pack-empty')).toBeVisible();
  await expect(page.getByTestId('pack-count')).toHaveText('0');
  await expect(page.getByTestId('build-pack')).toBeDisabled();
});

test('a finished sticker can be added to the pack', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);

  await expect(page.getByTestId('pack-count')).toHaveText('1');
  await expect(page.getByTestId('pack-item-0')).toContainText('one.png');
});

test('the pack keeps stickers from several sources', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await addOne(page, 'two.png', quadrants(600, 600), whatsappStatic.id);
  await addOne(page, 'three.png', solid(600, 600, [200, 60, 60, 255]), whatsappStatic.id);

  await expect(page.getByTestId('pack-count')).toHaveText('3');
  await expect(page.getByTestId('pack-list').getByRole('listitem')).toHaveCount(3);
});

test('a one-sticker pack warns about WhatsApp`s minimum but still builds', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);

  await expect(page.getByTestId('pack-issues')).toContainText('at least 3 stickers');
  await expect(page.getByTestId('build-pack')).toBeEnabled();
});

test('the archive contains every sticker, a manifest, a tray icon and a readme', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await addOne(page, 'two.png', quadrants(600, 600), whatsappStatic.id);
  await addOne(page, 'three.png', solid(600, 600, [200, 60, 60, 255]), whatsappStatic.id);

  const dir = await downloadPack(page, 'complete');
  const files = readdirSync(dir).sort();

  expect(files).toEqual([
    '01-whatsapp-static.webp',
    '02-whatsapp-static.webp',
    '03-whatsapp-static.webp',
    'README.txt',
    'contents.json',
    'tray.png',
  ]);
});

test('every sticker in the archive is still compliant', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await addOne(page, 'two.png', quadrants(600, 600), whatsappStatic.id);
  await addOne(page, 'three.png', solid(600, 600, [200, 60, 60, 255]), whatsappStatic.id);

  const dir = await downloadPack(page, 'compliant');

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.webp'))) {
    const bytes = new Uint8Array(readFileSync(join(dir, file)));
    expect(checkCompliance(bytes, whatsappStatic).issues, file).toEqual([]);
  }
});

test('the tray icon is a 96x96 PNG inside its own budget', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  const dir = await downloadPack(page, 'tray');

  const bytes = new Uint8Array(readFileSync(join(dir, 'tray.png')));
  const info = parsePNG(bytes);

  expect([info.width, info.height]).toEqual([96, 96]);
  expect(info.hasAlpha).toBe(true);
  expect(bytes.byteLength).toBeLessThanOrEqual(STICKER_SPECS['whatsapp-tray'].maxBytes);
});

test('contents.json lists exactly the files that are present', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await addOne(page, 'two.png', quadrants(600, 600), whatsappStatic.id);

  const dir = await downloadPack(page, 'manifest');
  const contents = JSON.parse(readFileSync(join(dir, 'contents.json'), 'utf8')) as {
    sticker_packs: {
      name: string;
      publisher: string;
      tray_image_file: string;
      stickers: { image_file: string; emojis: string[] }[];
    }[];
  };

  const packEntry = contents.sticker_packs[0]!;
  expect(packEntry.stickers).toHaveLength(2);
  expect(readdirSync(dir)).toContain(packEntry.tray_image_file);

  for (const sticker of packEntry.stickers) {
    expect(readdirSync(dir), `${sticker.image_file} should be in the archive`).toContain(
      sticker.image_file,
    );
    expect(sticker.emojis.length).toBeGreaterThan(0);
  }
});

test('the pack name and publisher reach the manifest and the file name', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);

  await page.getByTestId('pack-name').fill('Holiday Cats');
  await page.getByTestId('pack-publisher').fill('Varun');

  const dir = await downloadPack(page, 'named');
  const contents = JSON.parse(readFileSync(join(dir, 'contents.json'), 'utf8')) as {
    sticker_packs: { name: string; publisher: string; identifier: string }[];
  };

  expect(contents.sticker_packs[0]?.name).toBe('Holiday Cats');
  expect(contents.sticker_packs[0]?.publisher).toBe('Varun');
  expect(contents.sticker_packs[0]?.identifier).toBe('holiday-cats');
});

test('emoji edited in the gallery reach the manifest', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await page.getByTestId('pack-emojis-0').fill('🎉🥳');

  const dir = await downloadPack(page, 'emoji');
  const contents = JSON.parse(readFileSync(join(dir, 'contents.json'), 'utf8')) as {
    sticker_packs: { stickers: { emojis: string[] }[] }[];
  };

  expect(contents.sticker_packs[0]?.stickers[0]?.emojis).toEqual(['🎉', '🥳']);
});

test('stickers can be reordered and removed before building', async ({ page }) => {
  await addOne(page, 'first.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await addOne(page, 'second.png', quadrants(600, 600), whatsappStatic.id);
  await addOne(page, 'third.png', solid(600, 600, [200, 60, 60, 255]), whatsappStatic.id);

  await page.getByTestId('pack-up-2').click();
  await expect(page.getByTestId('pack-item-1')).toContainText('third.png');

  await page.getByTestId('pack-remove-0').click();
  await expect(page.getByTestId('pack-count')).toHaveText('2');
  await expect(page.getByTestId('pack-item-0')).toContainText('third.png');
});

test('a Telegram sticker gets telegram.json and no WhatsApp manifest', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(900, 600), telegramStatic.id);

  const dir = await downloadPack(page, 'telegram');
  const files = readdirSync(dir).sort();

  expect(files).toContain('telegram.json');
  expect(files).not.toContain('contents.json');

  const manifest = JSON.parse(readFileSync(join(dir, 'telegram.json'), 'utf8')) as {
    stickers: { file: string; format: string }[];
    note: string;
  };
  expect(manifest.stickers).toHaveLength(1);
  expect(manifest.note).toContain('@Stickers');
  expect(files).toContain(manifest.stickers[0]?.file);
});

test('the readme explains how to install what is in the archive', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(900, 600), telegramStatic.id);

  const dir = await downloadPack(page, 'readme');
  const readme = readFileSync(join(dir, 'README.txt'), 'utf8');

  expect(readme).toContain('@Stickers');
  expect(readme).toContain('My stickers');
});

test('changing the pack invalidates a previously built archive', async ({ page }) => {
  await addOne(page, 'one.png', gradientWithAlpha(600, 600), whatsappStatic.id);
  await page.getByTestId('build-pack').click();
  await expect(page.getByTestId('download-pack')).toBeVisible({ timeout: 60_000 });

  // The download link must not survive an edit, or it would hand back an
  // archive that no longer matches what is on screen.
  await page.getByTestId('pack-name').fill('Something else');
  await expect(page.getByTestId('download-pack')).toHaveCount(0);
});
