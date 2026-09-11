import { expect, test } from '@playwright/test';

test('the app boots and renders its heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('./');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('stage')).toBeVisible();
  expect(errors).toEqual([]);
});
