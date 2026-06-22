import { describe, expect, it } from 'vitest';
import { catalog, findSection, findSource, loadSection } from './catalog';

describe('sectioned Catalog', () => {
	it('exposes source and ordered section metadata without section prose', () => {
		const source = findSource('nineteen-eighty-four-21d7f7475a36');
		expect(source).toBeDefined();
		expect(source!.sections[0]).toEqual({ id: 'section-2', title: 'Chapter 1' });
		expect(source!.sections.at(-1)).toEqual({ id: 'section-26', title: 'THE END' });
		expect(source!.sections[0]).not.toHaveProperty('text');
		expect(catalog).toHaveLength(1);
	});

	it('loads only a requested section package with section-local Word Help', async () => {
		const source = catalog[0];
		const metadata = findSection(source, 'section-2');
		const loaded = await loadSection(source.id, metadata!.id);
		expect(loaded.content.id).toBe('section-2');
		expect(loaded.content.text).toContain('It was a bright cold day in April');
		expect(loaded.wordHelp.every(({ end }) => end <= loaded.content.text.length)).toBe(true);
	});
});
