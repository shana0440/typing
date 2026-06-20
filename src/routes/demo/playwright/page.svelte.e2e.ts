import { expect, test } from '@playwright/test';

const basePath = process.env.BASE_PATH ?? '';

test('has expected h1', async ({ page }) => {
	await page.goto(`${basePath}/demo/playwright/`);
	await expect(page.locator('h1')).toBeVisible();
});
