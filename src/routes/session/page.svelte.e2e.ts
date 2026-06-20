import { expect, test } from '@playwright/test';

const source =
	'Mara opened the window before sunrise. The street below was quiet, and the cool air smelled of rain.\n\nShe set a small lamp beside her book. Soon, a warm square of light rested on every page.';
const basePath = process.env.BASE_PATH ?? '';

function appPath(path: string): string {
	return `${basePath}${path}`;
}

test('reader types a bundled source through completion', async ({ page }) => {
	await page.goto(appPath('/'));
	await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The Window Light' })).toBeVisible();

	await page
		.getByRole('article')
		.filter({ has: page.getByRole('heading', { name: 'The Window Light' }) })
		.getByRole('button', { name: 'Begin reading' })
		.click();
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

test('Reading Progress resumes at a word boundary and can be restarted', async ({ page }) => {
	await page.goto(appPath('/session/?source=the-window-light'));
	await expect(page.getByLabel('0% complete')).toBeVisible();

	await page.keyboard.type('Mara ');
	await expect(page.getByLabel('3% complete')).toBeVisible();
	await page.keyboard.type('op');
	await expect(page.getByLabel('4% complete')).toBeVisible();

	await page.reload();
	await expect(page.getByLabel('3% complete')).toBeVisible();
	await page.keyboard.type('opened ');

	await page.getByRole('link', { name: 'Return to Catalog' }).click();
	const continuation = page.getByRole('region', { name: 'The Window Light' });
	await expect(continuation.getByText('Most recent')).toBeVisible();
	const resumedPercentage = Math.round(('Mara opened '.length / source.length) * 100);
	await expect(continuation.getByText(`${resumedPercentage}% complete`)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Continue reading' })).toBeVisible();

	await page.getByRole('button', { name: 'Continue reading' }).click();
	await expect(page.getByLabel(`${resumedPercentage}% complete`)).toBeVisible();
	await page.keyboard.type(source.slice('Mara opened '.length));
	await expect(page.getByText('Reading complete')).toBeVisible();
	await expect(page.getByText(/^Completed /)).toBeVisible();

	await page.getByRole('link', { name: 'Return to Catalog' }).click();
	await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
	await page
		.getByRole('article')
		.filter({ has: page.getByRole('heading', { name: 'The Window Light' }) })
		.getByRole('button', { name: 'Read again' })
		.click();
	await expect(page.getByLabel('0% complete')).toBeVisible();
});

test('corrupt Reading Progress does not break the reader', async ({ page }) => {
	await page.goto(appPath('/'));
	await page.evaluate(() => localStorage.setItem('typing-practice:reading-progress', '{broken'));
	await page.reload();

	await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
	const sourceCard = page
		.getByRole('article')
		.filter({ has: page.getByRole('heading', { name: 'The Window Light' }) });
	await expect(sourceCard.getByText('0% complete')).toBeVisible();
	await sourceCard.getByRole('button', { name: 'Begin reading' }).click();
	await expect(page.getByLabel('0% complete')).toBeVisible();
});

test('Word Help supports words, phrases, missing help, and paused typing', async ({ page }) => {
	await page.goto(appPath('/session/?source=the-window-light'));
	const session = page.getByRole('region', { name: 'Typing Session' });
	await expect(session).toBeFocused();

	await page.keyboard.press('Alt+h');
	await expect(page.getByRole('status')).toContainText('No Word Help was prepared');
	await page.keyboard.type('Mara ');
	await expect(page.getByLabel('3% complete')).toBeVisible();

	await page.evaluate(() =>
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '˙',
				code: 'KeyH',
				altKey: true,
				bubbles: true,
				cancelable: true
			})
		)
	);
	let help = page.getByRole('dialog', { name: 'opened' });
	await expect(help).toBeVisible();
	await expect(help.getByText('在此表示把原本關著的窗戶打開，讓空氣進入。')).toBeVisible();
	await expect(help.getByRole('heading', { name: 'Generated example' })).toBeVisible();
	await expect(help.locator('mark')).toHaveText('opened');

	await page.keyboard.type('opened ');
	await expect(page.getByLabel('3% complete')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(help).toBeHidden();
	await expect(session).toBeFocused();

	await page.keyboard.type('opened the window ');
	await page.keyboard.press('Alt+h');
	help = page.getByRole('dialog', { name: 'before sunrise' });
	await expect(help.locator('mark')).toHaveText('before sunrise');
	await expect(help.getByText('Mara opened the window before sunrise.')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(session).toBeFocused();
});
