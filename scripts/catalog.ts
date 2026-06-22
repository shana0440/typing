import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
	assembleSourcePackage,
	type SourceManifest,
	type SourcePackage
} from '../src/lib/catalog-package.ts';
import type { ReadingSource, WordHelpAnnotation } from '../src/lib/catalog.ts';

type CatalogIndexEntry = Omit<SourceManifest, 'sectionIds'>;

function json(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
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

async function readPackage(directory: string): Promise<SourcePackage> {
	const manifest = JSON.parse(
		await readFile(join(directory, 'manifest.json'), 'utf8')
	) as SourceManifest;
	if (manifest.id !== basename(directory)) {
		throw new Error(`Source directory does not match manifest ID: ${basename(directory)}`);
	}
	const sections: SourcePackage['sections'] = {};
	for (const sectionId of manifest.sectionIds) {
		const sectionDirectory = join(directory, 'sections', sectionId);
		sections[sectionId] = {
			content: JSON.parse(await readFile(join(sectionDirectory, 'content.json'), 'utf8')),
			wordHelp: JSON.parse(await readFile(join(sectionDirectory, 'word-help.json'), 'utf8'))
		};
	}
	return { manifest, sections };
}

async function readPackages(rootDirectory: string): Promise<SourcePackage[]> {
	const sourcesDirectory = join(rootDirectory, 'sources');
	const entries = await readdir(sourcesDirectory, { withFileTypes: true });
	return Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && !entry.name.includes('.tmp-'))
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => readPackage(join(sourcesDirectory, entry.name)))
	);
}

function generatedIndex(packages: SourcePackage[]): CatalogIndexEntry[] {
	return packages
		.map(({ manifest }) => indexEntry(manifest))
		.sort((left, right) => left.id.localeCompare(right.id));
}

async function writeIndex(rootDirectory: string, packages: SourcePackage[]): Promise<void> {
	const indexPath = join(rootDirectory, 'index.json');
	const temporaryPath = `${indexPath}.tmp-${process.pid}`;
	await writeFile(temporaryPath, json(generatedIndex(packages)), 'utf8');
	await rename(temporaryPath, indexPath);
}

function sourcePackage(source: ReadingSource): SourcePackage {
	const sections: SourcePackage['sections'] = {};
	const assigned = new Set<number>();
	let sectionStart = 0;
	for (const section of source.sections) {
		const wordHelp = source.wordHelp.flatMap((annotation, annotationIndex) => {
			const sectionEnd = sectionStart + section.text.length;
			if (annotation.start < sectionStart || annotation.end > sectionEnd) return [];
			if (annotation.sentenceStart < sectionStart || annotation.sentenceEnd > sectionEnd) {
				throw new Error(`Word Help crosses a section boundary: ${source.id}/${annotation.id}`);
			}
			assigned.add(annotationIndex);
			return [
				{
					...annotation,
					start: annotation.start - sectionStart,
					end: annotation.end - sectionStart,
					sentenceStart: annotation.sentenceStart - sectionStart,
					sentenceEnd: annotation.sentenceEnd - sectionStart
				} satisfies WordHelpAnnotation
			];
		});
		sections[section.id] = { content: section, wordHelp };
		sectionStart += section.text.length + 2;
	}
	const unassigned = source.wordHelp.find((_, index) => !assigned.has(index));
	if (unassigned)
		throw new Error(`Word Help crosses a section boundary: ${source.id}/${unassigned.id}`);

	const packaged: SourcePackage = {
		manifest: {
			id: source.id,
			title: source.title,
			author: source.author,
			language: source.language,
			originalUrl: source.originalUrl,
			sectionIds: source.sections.map((section) => section.id)
		},
		sections
	};
	assembleSourcePackage(packaged);
	return packaged;
}

async function writePackage(rootDirectory: string, packaged: SourcePackage): Promise<void> {
	const finalDirectory = join(rootDirectory, 'sources', packaged.manifest.id);
	const temporaryDirectory = `${finalDirectory}.tmp-${process.pid}`;
	await rm(temporaryDirectory, { recursive: true, force: true });
	await mkdir(temporaryDirectory, { recursive: true });
	await writeFile(join(temporaryDirectory, 'manifest.json'), json(packaged.manifest));
	for (const sectionId of packaged.manifest.sectionIds) {
		const sectionDirectory = join(temporaryDirectory, 'sections', sectionId);
		await mkdir(sectionDirectory, { recursive: true });
		await writeFile(
			join(sectionDirectory, 'content.json'),
			json(packaged.sections[sectionId].content)
		);
		await writeFile(
			join(sectionDirectory, 'word-help.json'),
			json(packaged.sections[sectionId].wordHelp)
		);
	}
	await rm(finalDirectory, { recursive: true, force: true });
	await rename(temporaryDirectory, finalDirectory);
}

export async function migrateCatalog(legacyPath: string, rootDirectory: string): Promise<void> {
	const legacy = JSON.parse(await readFile(legacyPath, 'utf8')) as ReadingSource[];
	if (!Array.isArray(legacy)) throw new Error('Legacy Catalog root must be an array.');
	const packages = legacy.map(sourcePackage);
	if (new Set(packages.map(({ manifest }) => manifest.id)).size !== packages.length) {
		throw new Error('Legacy Catalog contains duplicate source IDs.');
	}
	for (const packaged of packages) await writePackage(rootDirectory, packaged);
	await writeIndex(rootDirectory, packages);
	const migratedById = new Map(
		(await readPackages(rootDirectory)).map((packaged) => [
			packaged.manifest.id,
			assembleSourcePackage(packaged)
		])
	);
	for (const source of legacy) {
		if (JSON.stringify(migratedById.get(source.id)) !== JSON.stringify(source)) {
			throw new Error(`Migrated package does not reproduce legacy source: ${source.id}`);
		}
	}
}

export async function validateCatalog(rootDirectory: string): Promise<void> {
	const packages = await readPackages(rootDirectory);
	if (new Set(packages.map(({ manifest }) => manifest.id)).size !== packages.length) {
		throw new Error('Catalog contains duplicate source IDs.');
	}
	for (const packaged of packages) assembleSourcePackage(packaged);
	const actualIndex = JSON.parse(await readFile(join(rootDirectory, 'index.json'), 'utf8'));
	if (JSON.stringify(actualIndex) !== JSON.stringify(generatedIndex(packages))) {
		throw new Error('Catalog index is stale. Run: npm run catalog:index');
	}
}

async function main(): Promise<void> {
	const [command, argument] = process.argv.slice(2);
	const rootDirectory = resolve('src/lib/catalog-data');
	if (command === 'migrate') {
		if (!argument) throw new Error('Usage: npm run catalog:migrate -- <legacy-catalog.json>');
		await migrateCatalog(resolve(argument), rootDirectory);
		console.log(`Migrated Catalog packages to ${rootDirectory}`);
	} else if (command === 'index') {
		await writeIndex(rootDirectory, await readPackages(rootDirectory));
		console.log(`Regenerated ${join(rootDirectory, 'index.json')}`);
	} else if (command === 'validate') {
		await validateCatalog(rootDirectory);
		console.log(`Validated ${rootDirectory}`);
	} else {
		throw new Error(
			'Usage: node scripts/catalog.ts <migrate|index|validate> [legacy-catalog.json]'
		);
	}
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
