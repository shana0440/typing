import { describe, expect, it } from 'vitest';
import { startSourcePath } from './source-route';
import type { CatalogSource } from './catalog';

const source: CatalogSource = {
	id: 'source',
	title: 'Source',
	author: 'Author',
	language: 'en',
	originalUrl: null,
	sections: [{ id: 'only', title: 'Only section' }]
};

describe('startSourcePath', () => {
	it('skips section selection for a single-section Reading Source', () => {
		expect(startSourcePath(source)).toBe('/sources/source/sections/only');
	});

	it('opens section selection for a multi-section Reading Source', () => {
		expect(
			startSourcePath({ ...source, sections: [...source.sections, { id: 'two', title: 'Two' }] })
		).toBe('/sources/source');
	});
});
