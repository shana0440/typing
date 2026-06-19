import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReadingSource } from '../catalog.ts';
import { draftSourceText } from './draft.ts';
import { ImportError } from './extract.ts';
import type { ImportDraft } from './types.ts';

export function catalogSourceFromDraft(draft: ImportDraft): ReadingSource {
	if (!draft.redistributionConfirmed || draft.status !== 'analyzed') {
		throw new ImportError('Import Draft must be analyzed and authorized before Publish.');
	}
	return {
		id: draft.id,
		title: draft.metadata.title,
		author: draft.metadata.author ?? 'Unknown author',
		language: 'en',
		originalUrl: draft.metadata.originalUrl,
		sections: draft.source.sections.map((section, index) => ({
			id: section.id,
			title: section.heading ?? `Section ${index + 1}`,
			text: section.blocks.map((block) => block.text).join('\n\n')
		})),
		wordHelp: draft.annotations
	};
}

export async function publishDraft(draft: ImportDraft, catalogPath: string): Promise<void> {
	let catalog: ReadingSource[] = [];
	try {
		const existing = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown;
		if (!Array.isArray(existing)) throw new Error('Catalog root must be an array');
		catalog = existing as ReadingSource[];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw new ImportError(`Could not read Catalog artifact: ${(error as Error).message}`);
		}
	}

	const source = catalogSourceFromDraft(draft);
	if (draftSourceText(draft) !== source.sections.map((section) => section.text).join('\n\n')) {
		throw new ImportError('Publish would alter immutable source content.');
	}
	const nextCatalog = [...catalog.filter((entry) => entry.id !== source.id), source].sort((a, b) =>
		a.id.localeCompare(b.id)
	);
	await mkdir(dirname(catalogPath), { recursive: true });
	const temporaryPath = `${catalogPath}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(nextCatalog, null, '\t')}\n`, 'utf8');
	await rename(temporaryPath, catalogPath);
}
