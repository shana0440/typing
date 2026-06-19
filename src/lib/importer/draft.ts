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
	const draft = value as Partial<ImportDraft>;
	if (
		draft.schemaVersion !== 1 ||
		!['draft', 'analyzed'].includes(draft.status ?? '') ||
		typeof draft.id !== 'string' ||
		!draft.metadata ||
		typeof draft.metadata.title !== 'string' ||
		draft.metadata.language !== 'en' ||
		typeof draft.metadata.originalUrl !== 'string' ||
		!draft.source ||
		!Array.isArray(draft.source.sections) ||
		!Array.isArray(draft.annotations) ||
		typeof draft.redistributionConfirmed !== 'boolean'
	) {
		throw new ImportError('Import Draft is malformed or uses an unsupported schema version.');
	}
	return draft as ImportDraft;
}

export async function writeImportDraft(path: string, draft: ImportDraft): Promise<void> {
	await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
}

export function draftSourceText(draft: ImportDraft): string {
	return draft.source.sections
		.map((section) => section.blocks.map((block) => block.text).join('\n\n'))
		.join('\n\n');
}
