import { describe, expect, it } from 'vitest';
import { validateBlockAnalysis } from './analyze.ts';
import { draftSourceBlocks, draftSourceText } from './draft.ts';
import type { ImportDraft } from './types.ts';

describe('Codex annotation validation', () => {
	it('uses JavaScript UTF-16 offsets for source spans', () => {
		const text = 'A 😊 intricate device remained still.';
		const draft: ImportDraft = {
			schemaVersion: 1,
			status: 'draft',
			id: 'unicode-source',
			metadata: {
				title: 'Unicode Source',
				author: null,
				language: 'en',
				originalUrl: 'https://example.com/unicode'
			},
			source: {
				sections: [
					{
						id: 'section-1',
						heading: null,
						blocks: [{ type: 'paragraph', text }]
					}
				]
			},
			annotations: [],
			redistributionConfirmed: false
		};
		const start = draftSourceText(draft).indexOf('intricate');
		const annotations = validateBlockAnalysis(draftSourceBlocks(draft)[0], {
			sourceText: text,
			annotations: [
				{
					id: 'intricate',
					start,
					end: start + 'intricate'.length,
					sentenceStart: 0,
					sentenceEnd: text.length,
					explanationZhTw: '表示具有許多複雜且互相連動的細節。',
					generatedExample: 'The clock contains an intricate mechanism.',
					category: 'term',
					cefrLevel: 'B2'
				}
			]
		});

		expect(start).toBe(5);
		expect(annotations[0]).toMatchObject({ start: 5, end: 14 });
	});
});
