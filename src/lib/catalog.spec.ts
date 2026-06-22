import { describe, expect, it } from 'vitest';
import { catalog, findSource, sourceText } from './catalog';

describe('packaged Catalog source', () => {
	it('loads through the existing Catalog interface with exact text and Word Help', () => {
		const source = findSource('the-window-light');
		expect(source).toBeDefined();
		expect(sourceText(source!)).toBe(
			'Mara opened the window before sunrise. The street below was quiet, and the cool air smelled of rain.\n\nShe set a small lamp beside her book. Soon, a warm square of light rested on every page.'
		);
		expect(source!.wordHelp.map(({ id, start, end }) => ({ id, start, end }))).toEqual([
			{ id: 'opened', start: 5, end: 11 },
			{ id: 'before-sunrise', start: 23, end: 37 }
		]);
	});

	it('keeps legacy Reading Sources available during the tracer slice', () => {
		expect(catalog.some((source) => source.id !== 'the-window-light')).toBe(true);
	});
});
