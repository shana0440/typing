import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	assembleSourcePackage,
	type SourceManifest,
	type SourcePackage
} from '../catalog-package.ts';
import type { ReadingSection, WordHelpAnnotation } from '../catalog.ts';
import { draftSourceText } from './draft.ts';
import { ImportError } from './extract.ts';
import type { ImportAnnotation, ImportDraft } from './types.ts';

type CatalogIndexEntry = Omit<SourceManifest, 'sections'>;

export type PublishDestination = {
	rootDirectory: string;
	indexPath: string;
};

export type PublishHooks = {
	beforeIndexCommit?: () => void | Promise<void>;
};

function destinationFromPath(path: string): PublishDestination {
	return path.endsWith('.json')
		? { rootDirectory: dirname(path), indexPath: path }
		: { rootDirectory: path, indexPath: join(path, 'index.json') };
}

function localAnnotation(
	annotation: ImportAnnotation,
	section: ReadingSection,
	sectionStart: number
): WordHelpAnnotation | null {
	const sectionEnd = sectionStart + section.text.length;
	if (annotation.start < sectionStart || annotation.end > sectionEnd) return null;
	if (annotation.sentenceStart < sectionStart || annotation.sentenceEnd > sectionEnd) {
		throw new ImportError(`Word Help annotation crosses a section boundary: ${annotation.id}`);
	}
	return {
		...annotation,
		start: annotation.start - sectionStart,
		end: annotation.end - sectionStart,
		sentenceStart: annotation.sentenceStart - sectionStart,
		sentenceEnd: annotation.sentenceEnd - sectionStart
	};
}

export function sourcePackageFromDraft(draft: ImportDraft): SourcePackage {
	if (!draft.redistributionConfirmed || draft.status !== 'analyzed') {
		throw new ImportError('Import Draft must be analyzed and authorized before Publish.');
	}
	const assembledText = draftSourceText(draft);
	const sections = draft.source.sections.map(
		(section, index): ReadingSection => ({
			id: section.id,
			title: section.heading ?? `Section ${index + 1}`,
			text: section.blocks.map((block) => block.text).join('\n\n')
		})
	);
	if (assembledText !== sections.map((section) => section.text).join('\n\n')) {
		throw new ImportError('Publish would alter immutable source content.');
	}

	const packagedSections: SourcePackage['sections'] = {};
	let sectionStart = 0;
	const assigned = new Set<string>();
	for (const section of sections) {
		const wordHelp = draft.annotations.flatMap((annotation) => {
			const local = localAnnotation(annotation, section, sectionStart);
			if (!local) return [];
			assigned.add(annotation.id);
			return [local];
		});
		packagedSections[section.id] = { content: section, wordHelp };
		sectionStart += section.text.length + 2;
	}
	const unassigned = draft.annotations.find((annotation) => !assigned.has(annotation.id));
	if (unassigned) {
		throw new ImportError(`Word Help annotation crosses a section boundary: ${unassigned.id}`);
	}

	const sourcePackage: SourcePackage = {
		manifest: {
			id: draft.id,
			title: draft.metadata.title,
			author: draft.metadata.author ?? 'Unknown author',
			language: 'en',
			originalUrl: draft.metadata.originalUrl,
			sections: sections.map(({ id, title }) => ({ id, title }))
		},
		sections: packagedSections
	};
	assembleSourcePackage(sourcePackage);
	return sourcePackage;
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

async function writePackage(directory: string, sourcePackage: SourcePackage): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'manifest.json'), json(sourcePackage.manifest), 'utf8');
	for (const { id: sectionId } of sourcePackage.manifest.sections) {
		const sectionDirectory = join(directory, 'sections', sectionId);
		await mkdir(sectionDirectory, { recursive: true });
		await writeFile(
			join(sectionDirectory, 'content.json'),
			json(sourcePackage.sections[sectionId].content),
			'utf8'
		);
		await writeFile(
			join(sectionDirectory, 'word-help.json'),
			json(sourcePackage.sections[sectionId].wordHelp),
			'utf8'
		);
	}
}

async function readManifests(sourcesDirectory: string): Promise<SourceManifest[]> {
	try {
		const directories = await readdir(sourcesDirectory, { withFileTypes: true });
		return await Promise.all(
			directories
				.filter((entry) => entry.isDirectory() && !entry.name.includes('.tmp-'))
				.map(async (entry) => {
					try {
						return JSON.parse(
							await readFile(join(sourcesDirectory, entry.name, 'manifest.json'), 'utf8')
						) as SourceManifest;
					} catch (error) {
						throw new ImportError(
							`Could not read source manifest ${entry.name}: ${(error as Error).message}`
						);
					}
				})
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

function indexEntry(manifest: SourceManifest): CatalogIndexEntry {
	return {
		id: manifest.id,
		title: manifest.title,
		author: manifest.author,
		language: manifest.language,
		originalUrl: manifest.originalUrl
	};
}

export async function publishDraft(
	draft: ImportDraft,
	destinationPath: string,
	hooks: PublishHooks = {}
): Promise<void> {
	const destination = destinationFromPath(destinationPath);
	const sourcePackage = sourcePackageFromDraft(draft);
	const sourcesDirectory = join(destination.rootDirectory, 'sources');
	const currentManifests = await readManifests(sourcesDirectory);
	const nextIndex = [
		...currentManifests
			.filter((manifest) => manifest.id !== sourcePackage.manifest.id)
			.map(indexEntry),
		indexEntry(sourcePackage.manifest)
	].sort((left, right) => left.id.localeCompare(right.id));

	const finalPackage = join(sourcesDirectory, sourcePackage.manifest.id);
	const transaction = `${sourcePackage.manifest.id}.tmp-${process.pid}`;
	const stagedPackage = join(sourcesDirectory, transaction);
	const backupPackage = join(sourcesDirectory, `${transaction}.backup`);
	const stagedIndex = `${destination.indexPath}.tmp-${process.pid}`;
	let backedUp = false;
	let installed = false;
	try {
		await mkdir(sourcesDirectory, { recursive: true });
		await rm(stagedPackage, { recursive: true, force: true });
		await rm(backupPackage, { recursive: true, force: true });
		await writePackage(stagedPackage, sourcePackage);
		await writeFile(stagedIndex, json(nextIndex), 'utf8');
		try {
			await rename(finalPackage, backupPackage);
			backedUp = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		await rename(stagedPackage, finalPackage);
		installed = true;
		await hooks.beforeIndexCommit?.();
		await rename(stagedIndex, destination.indexPath);
		await rm(backupPackage, { recursive: true, force: true });
	} catch (error) {
		if (installed) await rm(finalPackage, { recursive: true, force: true });
		if (backedUp) await rename(backupPackage, finalPackage);
		throw error;
	} finally {
		await rm(stagedPackage, { recursive: true, force: true });
		await rm(stagedIndex, { force: true });
		await rm(backupPackage, { recursive: true, force: true });
	}
}
