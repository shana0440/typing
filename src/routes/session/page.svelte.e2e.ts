import { expect, test } from '@playwright/test';

const source =
	'Mara opened the window before sunrise. The street below was quiet, and the cool air smelled of rain.\n\nShe set a small lamp beside her book. Soon, a warm square of light rested on every page.';

test('reader types a bundled source through completion', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The Window Light' })).toBeVisible();

	await page.getByRole('link', { name: 'Begin reading' }).click();
	await expect(page.getByRole('region', { name: 'Typing Session' })).toBeVisible();
	await expect(page.getByLabel('0% complete')).toBeVisible();

	await page.keyboard.type('X');
	await expect(page.getByRole('status')).toContainText('Expected "M"');
	await expect(page.getByLabel('0% complete')).toBeVisible();

	await page.keyboard.type('M');
	await expect(page.getByRole('status')).toHaveText('');
	await expect(page.getByLabel('1% complete')).toBeVisible();

	await page.keyboard.type(source.slice(1, source.indexOf('\n')));
	await page.keyboard.type(source.slice(source.indexOf('\n') + 2));

	await expect(page.getByText('Reading complete')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The Window Light' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Return to Catalog' })).toBeVisible();

	await page.getByRole('button', { name: 'Read again' }).click();
	await expect(page.getByRole('region', { name: 'Typing Session' })).toBeVisible();
	await expect(page.getByLabel('0% complete')).toBeVisible();
});
