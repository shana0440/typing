import catalogIndex from './catalog-data/index.json';
import { assembleSourcePackage, type SourceManifest, type SourcePackage } from './catalog-package';

export type ReadingSection = {
	id: string;
	title: string;
	text: string;
};

export type WordHelpAnnotation = {
	id: string;
	start: number;
	end: number;
	sentenceStart: number;
	sentenceEnd: number;
	explanationZhTw: string;
	generatedExample: string;
	category: 'term' | 'idiom' | 'phrasal-verb' | 'contextual-meaning';
	cefrLevel: 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null;
};

export type ReadingSource = {
	id: string;
	title: string;
	author: string;
	language: 'en';
	originalUrl: string | null;
	sections: ReadingSection[];
	wordHelp: WordHelpAnnotation[];
};

const manifests = import.meta.glob('./catalog-data/sources/*/manifest.json', {
	eager: true,
	import: 'default'
}) as Record<string, SourceManifest>;
const contents = import.meta.glob('./catalog-data/sources/*/sections/*/content.json', {
	eager: true,
	import: 'default'
}) as Record<string, ReadingSection>;
const wordHelpFiles = import.meta.glob('./catalog-data/sources/*/sections/*/word-help.json', {
	eager: true,
	import: 'default'
}) as Record<string, WordHelpAnnotation[]>;

function packagePath(sourceId: string, sectionId?: string): string {
	return sectionId
		? `./catalog-data/sources/${sourceId}/sections/${sectionId}`
		: `./catalog-data/sources/${sourceId}/manifest.json`;
}

const packagedSources = (catalogIndex as Omit<ReadingSource, 'sections' | 'wordHelp'>[]).map(
	(indexEntry) => {
		const manifest = manifests[packagePath(indexEntry.id)];
		if (!manifest) throw new Error(`Catalog index references a missing source: ${indexEntry.id}`);
		const sourcePackage: SourcePackage = { manifest, sections: {} };
		for (const sectionId of manifest.sectionIds) {
			const base = packagePath(manifest.id, sectionId);
			sourcePackage.sections[sectionId] = {
				content: contents[`${base}/content.json`],
				wordHelp: wordHelpFiles[`${base}/word-help.json`]
			};
		}
		return assembleSourcePackage(sourcePackage);
	}
);
export const catalog: ReadingSource[] = packagedSources.sort((left, right) =>
	left.id.localeCompare(right.id)
);

export function findSource(id: string | null): ReadingSource | undefined {
	return catalog.find((source) => source.id === id);
}

export function sourceText(source: ReadingSource): string {
	return source.sections.map((section) => section.text).join('\n\n');
}
