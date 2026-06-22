import { describe, expect, it } from 'vitest';
import { assembleSourcePackage, type SourcePackage } from './catalog-package';

function sourcePackage(): SourcePackage {
	return {
		manifest: {
			id: 'packaged-source',
			title: 'Packaged Source',
			author: 'Example',
			language: 'en',
			originalUrl: null,
			sectionIds: ['first', 'second']
		},
		sections: {
			first: { content: { id: 'first', title: 'First', text: 'First text.' }, wordHelp: [] },
			second: {
				content: { id: 'second', title: 'Second', text: 'Second phrase.' },
				wordHelp: [
					{
						id: 'phrase',
						start: 7,
						end: 13,
						sentenceStart: 0,
						sentenceEnd: 14,
						explanationZhTw: '片語',
						generatedExample: 'A phrase.',
						category: 'term',
						cefrLevel: 'A2'
					}
				]
			}
		}
	};
}

describe('assembleSourcePackage', () => {
	it('preserves section order and rebases section-local Word Help offsets', () => {
		const source = assembleSourcePackage(sourcePackage());
		expect(source.sections.map((section) => section.id)).toEqual(['first', 'second']);
		expect(source.wordHelp[0]).toMatchObject({
			start: 20,
			end: 26,
			sentenceStart: 13,
			sentenceEnd: 27
		});
		expect(
			source.sections
				.map((section) => section.text)
				.join('\n\n')
				.slice(20, 26)
		).toBe('phrase');
	});

	it('rejects missing sections and invalid local spans', () => {
		const missing = sourcePackage();
		delete missing.sections.second;
		expect(() => assembleSourcePackage(missing)).toThrow('Missing or invalid section second');

		const invalid = sourcePackage();
		invalid.sections.second.wordHelp[0].end = 99;
		expect(() => assembleSourcePackage(invalid)).toThrow('Invalid Word Help span');
	});
});
