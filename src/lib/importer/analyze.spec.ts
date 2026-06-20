import { describe, expect, it } from 'vitest';
import {
	partitionAnalysisBatches,
	validateBatchAnalysis,
	validateBlockAnalysis
} from './analyze.ts';
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
			key: 'section-1:0',
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

	it('partitions by block count and source character limit', () => {
		const blocks = [10_000, 14_000, 1, 25_000, 2].map((length, index) => ({
			key: `block-${index}`,
			text: 'x'.repeat(length),
			globalStart: 0,
			sectionHeading: null
		}));

		expect(partitionAnalysisBatches(blocks, 3).map((batch) => batch.map(({ key }) => key))).toEqual(
			[['block-0', 'block-1'], ['block-2'], ['block-3'], ['block-4']]
		);
	});

	it.each([
		['missing', { results: [] }, 'omitted block result'],
		[
			'duplicate',
			{
				results: [
					{ key: 'section-1:0', sourceText: 'text', annotations: [] },
					{ key: 'section-1:0', sourceText: 'text', annotations: [] }
				]
			},
			'duplicate block result'
		],
		[
			'unexpected',
			{ results: [{ key: 'other', sourceText: 'text', annotations: [] }] },
			'unexpected block result'
		]
	])('rejects %s keyed results', (_name, output, message) => {
		const block = { key: 'section-1:0', text: 'text', globalStart: 0, sectionHeading: null };
		expect(() => validateBatchAnalysis([block], output)).toThrow(message);
	});
});
