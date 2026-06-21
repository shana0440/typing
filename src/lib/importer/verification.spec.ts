import { describe, expect, it } from 'vitest';
import { analyzeImportDraft } from './analyze.ts';
import { rejectImportDraft, verifyImportDraft } from './draft.ts';
import { renderVerification } from './preview.ts';
import type { ImportDraft } from './types.ts';

function extracted(): ImportDraft {
	const sections = [
		{
			id: 'section-1',
			heading: null,
			blocks: [{ type: 'paragraph' as const, text: '<script>alert(1)</script> exact prose' }]
		}
	];
	return {
		schemaVersion: 2,
		status: 'extracted',
		id: 'source',
		metadata: {
			title: 'Suggested',
			author: null,
			language: 'en',
			requestedUrl: 'https://example.com/requested',
			finalUrl: 'https://example.com/final',
			canonicalUrl: 'https://example.com/canonical',
			originalUrl: 'https://example.com/final',
			titleSuggestions: [{ value: 'Suggested', origin: 'document title' }],
			authorSuggestions: []
		},
		candidates: [
			{
				id: 'body-1',
				origin: 'body',
				label: 'Cleaned document body',
				score: 10,
				sections,
				characterCount: 42,
				blockCount: 1,
				warnings: []
			}
		],
		selectedCandidateId: 'body-1',
		source: { sections: structuredClone(sections) },
		blocked: null,
		diagnostics: {
			fetchedAt: '',
			httpStatus: 200,
			contentType: 'text/html',
			redirected: true,
			messages: []
		},
		annotations: [],
		redistributionConfirmed: false
	};
}

describe('Source Verification', () => {
	it('selects one whole candidate and permits metadata corrections only', () => {
		const draft = extracted();
		verifyImportDraft(draft, {
			candidateId: 'body-1',
			title: 'Correct title',
			author: 'Correct author'
		});
		expect(draft).toMatchObject({
			status: 'verified',
			metadata: { title: 'Correct title', author: 'Correct author' },
			selectedCandidateId: 'body-1'
		});
		expect(draft.source.sections[0].blocks[0].text).toBe('<script>alert(1)</script> exact prose');
	});

	it('requires title and a complete candidate', () => {
		expect(() => verifyImportDraft(extracted(), { candidateId: 'body-1', title: '' })).toThrow(
			'title is required'
		);
		expect(() =>
			verifyImportDraft(extracted(), { candidateId: 'missing', title: 'Title' })
		).toThrow('one complete');
	});

	it('escapes structured preview content', () => {
		const html = renderVerification(extracted());
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<script>alert(1)</script>');
	});

	it('records operator rejection and blocks analysis', async () => {
		const draft = rejectImportDraft(extracted());
		expect(draft).toMatchObject({ status: 'blocked', blocked: { reason: 'operator-rejected' } });
		await expect(analyzeImportDraft(draft)).rejects.toThrow('requires a verified');
	});
});
