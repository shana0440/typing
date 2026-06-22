import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImportDraft } from './types';
import { publishDraft, sourcePackageFromDraft } from './publish';

function draft(): ImportDraft {
	return {
		schemaVersion: 2,
		status: 'analyzed',
		id: 'two-sections',
		metadata: {
			title: 'Two Sections',
			author: 'Author',
			language: 'en',
			requestedUrl: 'https://example.com',
			finalUrl: 'https://example.com',
			canonicalUrl: null,
			originalUrl: 'https://example.com',
			titleSuggestions: [],
			authorSuggestions: []
		},
		candidates: [],
		selectedCandidateId: null,
		source: {
			sections: [
				{ id: 'one', heading: 'One', blocks: [{ type: 'paragraph', text: 'First.' }] },
				{ id: 'two', heading: 'Two', blocks: [{ type: 'paragraph', text: 'Second term.' }] }
			]
		},
		blocked: null,
		diagnostics: {
			fetchedAt: '',
			httpStatus: 200,
			contentType: 'text/html',
			redirected: false,
			messages: []
		},
		annotations: [
			{
				id: 'term',
				start: 15,
				end: 19,
				sentenceStart: 8,
				sentenceEnd: 20,
				explanationZhTw: '詞',
				generatedExample: 'A term.',
				category: 'term',
				cefrLevel: 'A2'
			}
		],
		redistributionConfirmed: true
	};
}

describe('packaged Publish', () => {
	it('converts global annotation offsets to section-local offsets', () => {
		const sourcePackage = sourcePackageFromDraft(draft());
		expect(sourcePackage.sections.two.wordHelp[0]).toMatchObject({
			start: 7,
			end: 11,
			sentenceStart: 0,
			sentenceEnd: 12
		});
	});

	it('rejects annotations that cross section boundaries', () => {
		const crossing = draft();
		crossing.annotations[0] = { ...crossing.annotations[0], start: 5, end: 9 };
		expect(() => sourcePackageFromDraft(crossing)).toThrow('crosses a section boundary');
	});

	it('restores the prior package and index when commit fails', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'typing-package-publish-'));
		const indexPath = join(directory, 'index.json');
		await writeFile(indexPath, '[]\n');
		await publishDraft(draft(), directory);
		const priorIndex = await readFile(indexPath, 'utf8');
		const priorManifest = await readFile(
			join(directory, 'sources', 'two-sections', 'manifest.json'),
			'utf8'
		);

		const replacement = draft();
		replacement.metadata.title = 'Replacement';
		await expect(
			publishDraft(replacement, directory, {
				beforeIndexCommit: () => {
					throw new Error('stop');
				}
			})
		).rejects.toThrow('stop');
		expect(await readFile(indexPath, 'utf8')).toBe(priorIndex);
		expect(
			await readFile(join(directory, 'sources', 'two-sections', 'manifest.json'), 'utf8')
		).toBe(priorManifest);
	});

	it('regenerates a deterministic index without rewriting unrelated packages', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'typing-package-index-'));
		const other = draft();
		other.id = 'another-source';
		other.metadata.title = 'Another Source';
		await publishDraft(other, directory);
		const otherManifest = join(directory, 'sources', 'another-source', 'manifest.json');
		const before = (await stat(otherManifest, { bigint: true })).mtimeNs;

		await publishDraft(draft(), directory);
		const indexAfterFirstPublish = await readFile(join(directory, 'index.json'), 'utf8');
		await publishDraft(draft(), directory);

		expect(await readFile(join(directory, 'index.json'), 'utf8')).toBe(indexAfterFirstPublish);
		expect(JSON.parse(indexAfterFirstPublish).map((entry: { id: string }) => entry.id)).toEqual([
			'another-source',
			'two-sections'
		]);
		expect((await stat(otherManifest, { bigint: true })).mtimeNs).toBe(before);
	});
});
