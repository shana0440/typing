import { readFile, writeFile } from 'node:fs/promises';
import type { ImportDraft } from './types.ts';
import { ImportError } from './extract.ts';

export async function readImportDraft(path: string): Promise<ImportDraft> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new ImportError(
			`Could not read Import Draft: ${error instanceof Error ? error.message : 'invalid file'}`
		);
	}

	if (!value || typeof value !== 'object')
		throw new ImportError('Import Draft must be a JSON object.');
	const legacy = value as Record<string, unknown> & {
		schemaVersion?: number;
		status?: string;
		metadata?: { title?: string; author?: string | null; originalUrl?: string };
	};
	if (
		legacy.schemaVersion === 1 &&
		typeof legacy.status === 'string' &&
		['draft', 'analyzed'].includes(legacy.status)
	) {
		const url = legacy.metadata?.originalUrl;
		value = {
			...legacy,
			schemaVersion: 2,
			status: legacy.status === 'analyzed' ? 'analyzed' : 'extracted',
			metadata: {
				...legacy.metadata,
				requestedUrl: url,
				finalUrl: url,
				canonicalUrl: null,
				titleSuggestions: [{ value: legacy.metadata?.title, origin: 'legacy draft' }],
				authorSuggestions: legacy.metadata?.author
					? [{ value: legacy.metadata.author, origin: 'legacy draft' }]
					: []
			},
			candidates: [],
			selectedCandidateId: null,
			blocked: null,
			diagnostics: {
				fetchedAt: '',
				httpStatus: null,
				contentType: null,
				redirected: false,
				messages: ['Migrated from schema version 1.']
			}
		};
	}
	const draft = value as Partial<ImportDraft>;
	if (
		draft.schemaVersion !== 2 ||
		!['extracted', 'verified', 'analyzed', 'blocked'].includes(draft.status ?? '') ||
		typeof draft.id !== 'string' ||
		!draft.metadata ||
		typeof draft.metadata.title !== 'string' ||
		draft.metadata.language !== 'en' ||
		typeof draft.metadata.originalUrl !== 'string' ||
		typeof draft.metadata.requestedUrl !== 'string' ||
		!Array.isArray(draft.candidates) ||
		!draft.source ||
		!Array.isArray(draft.source.sections) ||
		!Array.isArray(draft.annotations) ||
		typeof draft.redistributionConfirmed !== 'boolean'
	) {
		throw new ImportError('Import Draft is malformed or uses an unsupported schema version.');
	}
	return draft as ImportDraft;
}

export function verifyImportDraft(
	draft: ImportDraft,
	input: { candidateId: string; title: string; author?: string | null }
): ImportDraft {
	if (draft.status === 'blocked')
		throw new ImportError('A blocked Import Draft cannot be verified.');
	const candidate = draft.candidates.find((entry) => entry.id === input.candidateId);
	if (!candidate) throw new ImportError('Select one complete extraction candidate.');
	const title = input.title.trim();
	if (!title) throw new ImportError('A title is required before analysis.');
	const sourceChanged =
		draft.selectedCandidateId !== candidate.id ||
		JSON.stringify(draft.source.sections) !== JSON.stringify(candidate.sections);
	draft.selectedCandidateId = candidate.id;
	draft.source = { sections: structuredClone(candidate.sections) };
	draft.metadata.title = title;
	draft.metadata.author = input.author?.trim() || null;
	draft.status = 'verified';
	draft.blocked = null;
	draft.redistributionConfirmed = false;
	if (sourceChanged || draft.annotations.length) {
		draft.annotations = [];
		delete draft.analysisProgress;
	}
	return draft;
}

export function rejectImportDraft(
	draft: ImportDraft,
	diagnostic = 'The operator rejected every extraction candidate.'
): ImportDraft {
	draft.status = 'blocked';
	draft.blocked = { reason: 'operator-rejected', diagnostic };
	draft.annotations = [];
	delete draft.analysisProgress;
	draft.redistributionConfirmed = false;
	return draft;
}

export async function writeImportDraft(path: string, draft: ImportDraft): Promise<void> {
	await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
}

export function draftSourceText(draft: ImportDraft): string {
	return draftSourceBlocks(draft)
		.map((block) => block.text)
		.join('\n\n');
}

export type DraftSourceBlock = {
	key: string;
	text: string;
	globalStart: number;
	sectionHeading: string | null;
};

export function draftSourceBlocks(draft: ImportDraft): DraftSourceBlock[] {
	const blocks: DraftSourceBlock[] = [];
	let globalStart = 0;
	for (const section of draft.source.sections) {
		for (const [index, block] of section.blocks.entries()) {
			blocks.push({
				key: `${section.id}:${index}`,
				text: block.text,
				globalStart,
				sectionHeading: section.heading
			});
			globalStart += block.text.length + 2;
		}
	}
	return blocks;
}
