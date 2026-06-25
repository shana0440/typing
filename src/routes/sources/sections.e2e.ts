import { expect, test } from '@playwright/test';
const sourceId = 'nineteen-eighty-four-21d7f7475a36';
const section25Length = 26653;
const basePath = process.env.BASE_PATH ?? '';
const appPath = (path: string) => `${basePath}${path}`;
const sectionPath = (sectionId: string) => appPath(`/sources/${sourceId}/sections/${sectionId}/`);

function stored(
	sections: Record<
		string,
		{ position: number; textLength: number; lastActiveAt: string; completedAt: string | null }
	>
) {
	return JSON.stringify({ version: 2, sources: { [sourceId]: { sections } } });
}

test('Catalog selects a source and lists sections in source order', async ({ page }) => {
	await page.goto(appPath('/'));
	await page.getByRole('article').getByRole('link', { name: 'Begin reading' }).click();
	await expect(page).toHaveURL(new RegExp(`/sources/${sourceId}/$`));
	const sections = page.locator('.section-list li');
	await expect(sections).toHaveCount(25);
	await expect(sections.first()).toContainText('Chapter 1');
	await expect(sections.last()).toContainText('THE END');
	await sections.first().getByRole('link').click();
	await expect(page).toHaveURL(new RegExp(`/sections/section-2/$`));
	await expect(page.getByRole('region', { name: 'Typing Session' })).toBeVisible();
});

test('direct section navigation restores only that section', async ({ page }) => {
	await page.goto(sectionPath('section-2'));
	await expect(page.getByRole('region', { name: 'Typing Session' })).toBeFocused();
	await page.keyboard.type('It ');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('typing-practice:reading-progress')))
		.not.toBeNull();
	await page.reload();
	const progress = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('typing-practice:reading-progress')!)
	);
	expect(progress.sources[sourceId].sections['section-2'].position).toBe(3);
	expect(progress.sources[sourceId].sections['section-3']).toBeUndefined();
});

test('reading text scrolls and word help opens without interrupting typing', async ({ page }) => {
	await page.goto(sectionPath('section-2'));
	const viewport = page.locator('.text-viewport');
	await expect
		.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight))
		.toBe(true);
	await expect
		.poll(() =>
			viewport.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				return Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2);
			})
		)
		.toBeLessThan(1);
	await expect.poll(() => viewport.evaluate((element) => element.clientWidth)).toBeGreaterThan(800);
	await expect(page.locator('.help-character').first()).toBeVisible();

	await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
		key: 'typing-practice:reading-progress',
		value: stored({
			'section-2': {
				position: 50,
				textLength: 35427,
				lastActiveAt: '2026-06-22T00:00:00.000Z',
				completedAt: null
			}
		})
	});
	await page.reload();
	const typingStage = page.getByRole('region', { name: 'Typing Session' });
	await expect(typingStage).toBeFocused();
	await page.keyboard.type('were striking');
	await expect(
		page.getByRole('complementary').getByRole('heading', { name: 'were striking thirteen' })
	).toBeVisible();
	await expect(typingStage).toBeFocused();
	await expect(page.locator('.current-character')).toHaveClass(/newline-boundary/);
	await page.keyboard.type(' ');
	await expect(page.locator('.current-character')).toHaveText('t');
});

test('continue, aggregate status, next section, and restart are section-aware', async ({
	page
}) => {
	await page.goto(appPath('/'));
	await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
		key: 'typing-practice:reading-progress',
		value: stored({
			'section-2': {
				position: 3,
				textLength: 50000,
				lastActiveAt: '2026-06-20T00:00:00.000Z',
				completedAt: null
			},
			'section-3': {
				position: 4,
				textLength: 50000,
				lastActiveAt: '2026-06-21T00:00:00.000Z',
				completedAt: null
			},
			'section-25': {
				position: section25Length,
				textLength: section25Length,
				lastActiveAt: '2026-06-19T00:00:00.000Z',
				completedAt: '2026-06-19T00:00:00.000Z'
			}
		})
	});
	await page.reload();
	await page.getByRole('link', { name: 'Continue reading' }).click();
	await expect(page).toHaveURL(new RegExp('/sections/section-3/$'));
	await page.goto(appPath(`/sources/${sourceId}/`));
	await expect(page.getByText('1 of 25 sections completed')).toBeVisible();
	await expect(page.locator('.section-list li').nth(23)).toContainText('Completed');

	await page.goto(sectionPath('section-25'));
	await expect(page.getByText('Reading complete')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Next section' })).toHaveAttribute(
		'href',
		new RegExp('/sections/section-26/?$')
	);
	await page.getByRole('button', { name: 'Read again' }).click();
	await expect(page.getByRole('region', { name: 'Typing Session' })).toBeVisible();
	const remaining = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('typing-practice:reading-progress')!)
	);
	expect(remaining.sources[sourceId].sections['section-25']).toBeUndefined();
	expect(remaining.sources[sourceId].sections['section-3'].position).toBe(4);
});

test('unknown source and section routes return 404', async ({ request }) => {
	expect((await request.get(appPath('/sources/unknown/'))).status()).toBe(404);
	expect((await request.get(appPath(`/sources/${sourceId}/sections/unknown/`))).status()).toBe(404);
});

test('legacy query session route is removed', async ({ request }) => {
	expect((await request.get(appPath('/session/?source=anything'))).status()).toBe(404);
});
