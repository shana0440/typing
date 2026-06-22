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
			schemaVersion: 2,
			status: 'verified',
			id: 'unicode-source',
			metadata: {
				title: 'Unicode Source',
				author: null,
				language: 'en',
				originalUrl: 'https://example.com/unicode',
				requestedUrl: 'https://example.com/unicode',
				finalUrl: 'https://example.com/unicode',
				canonicalUrl: null,
				titleSuggestions: [],
				authorSuggestions: []
			},
			candidates: [],
			selectedCandidateId: null,
			blocked: null,
			diagnostics: {
				fetchedAt: '',
				httpStatus: 200,
				contentType: 'text/html',
				redirected: false,
				messages: []
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
			annotations: [
				{
					id: 'intricate',
					sourceQuote: 'intricate',
					sentenceQuote: text,
					explanationZhTw: '表示具有許多複雜且互相連動的細節。',
					generatedExample: 'The clock contains an intricate mechanism.',
					category: 'term',
					cefrLevel: 'A2'
				}
			]
		});

		expect(start).toBe(5);
		expect(annotations[0]).toMatchObject({ start: 5, end: 14, cefrLevel: 'A2' });
	});

	it('derives exact offsets from source quotes instead of model character counts', () => {
		const text =
			'This World Cup - co-hosted by the USA, Mexico and Canada - is averaging 3.09 goals per game and is on course to surpass 300 goals.';
		const block = { key: 'section-1:7', text, globalStart: 805, sectionHeading: null };

		const annotations = validateBlockAnalysis(block, {
			key: block.key,
			annotations: [
				{
					id: 'a1',
					sourceQuote: 'on course to',
					sentenceQuote: text,
					explanationZhTw: '表示「有望、正朝著某個結果前進」。',
					generatedExample: 'The company is on course to reach its target.',
					category: 'idiom',
					cefrLevel: 'B2'
				}
			]
		});

		expect(annotations[0]).toMatchObject({
			start: 904,
			end: 916,
			sentenceStart: 805,
			sentenceEnd: 935
		});
	});

	it('creates an annotation for every repeated source quote in its sentence', () => {
		const text =
			"Two of those goals were scored by Sweden's Yasin Ayari against Tunisia - from 24.8 yards and 24.3 yards respectively.";
		const block = { key: 'section-1:16', text, globalStart: 1839, sectionHeading: null };

		const annotations = validateBlockAnalysis(block, {
			key: block.key,
			annotations: [
				{
					id: 'a2',
					sourceQuote: 'yards',
					sentenceQuote: text,
					explanationZhTw: '英制長度單位「碼」。',
					generatedExample: 'The shop is about 50 yards away.',
					category: 'term',
					cefrLevel: 'A2'
				}
			]
		});

		expect(annotations.map(({ id, start, end }) => ({ id, start, end }))).toEqual([
			{ id: 'section-1:16-a2-1', start: 1922, end: 1927 },
			{ id: 'section-1:16-a2-2', start: 1937, end: 1942 }
		]);
	});

	it('matches source quotes across hard-wrapped whitespace', () => {
		const text = 'There was no way of knowing at any given\nmoment.';
		const block = { key: 'section-2:4', text, globalStart: 0, sectionHeading: null };

		const annotations = validateBlockAnalysis(block, {
			key: block.key,
			annotations: [
				{
					id: 'a7',
					sourceQuote: 'at any given moment',
					sentenceQuote: text,
					explanationZhTw: '表示在任何特定時刻。',
					generatedExample: 'The system may restart at any given moment.',
					category: 'idiom',
					cefrLevel: 'B2'
				}
			]
		});

		expect(annotations[0]).toMatchObject({ start: 28, end: 47 });
		expect(text.slice(annotations[0].start, annotations[0].end)).toBe('at any given\nmoment');
	});

	it('creates an annotation for every repeated sentence quote', () => {
		const slogan = 'DOWN WITH BIG BROTHER';
		const text = Array(5).fill(slogan).join('\n\n');
		const block = { key: 'section-2:39', text, globalStart: 33035, sectionHeading: null };

		const annotations = validateBlockAnalysis(block, {
			key: block.key,
			annotations: [
				{
					id: 'ann-1',
					sourceQuote: slogan,
					sentenceQuote: slogan,
					explanationZhTw: '表示打倒或反對。',
					generatedExample: 'The crowd shouted, "Down with the unfair law!"',
					category: 'idiom',
					cefrLevel: 'B1'
				}
			]
		});

		expect(annotations.map(({ id, start }) => ({ id, start }))).toEqual(
			[0, 23, 46, 69, 92].map((start, index) => ({
				id: `section-2:39-ann-1-${index + 1}`,
				start: 33035 + start
			}))
		);
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
					{ key: 'section-1:0', annotations: [] },
					{ key: 'section-1:0', annotations: [] }
				]
			},
			'duplicate block result'
		],
		['unexpected', { results: [{ key: 'other', annotations: [] }] }, 'unexpected block result']
	])('rejects %s keyed results', (_name, output, message) => {
		const block = { key: 'section-1:0', text: 'text', globalStart: 0, sectionHeading: null };
		expect(() => validateBatchAnalysis([block], output)).toThrow(message);
	});
});
