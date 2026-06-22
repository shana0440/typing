import catalogIndex from './catalog-data/index.json';
import type { SourceManifest } from './catalog-package';

export type ReadingSection = {
	id: string;
	title: string;
	text: string;
};

export type SectionMetadata = Pick<ReadingSection, 'id' | 'title'>;

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

export type CatalogSource = {
	id: string;
	title: string;
	author: string;
	language: 'en';
	originalUrl: string | null;
	sections: SectionMetadata[];
};

export type ReadingSource = Omit<CatalogSource, 'sections'> & {
	sections: ReadingSection[];
	wordHelp: WordHelpAnnotation[];
};

export type LoadedSection = {
	content: ReadingSection;
	wordHelp: WordHelpAnnotation[];
};

const manifests = import.meta.glob('./catalog-data/sources/*/manifest.json', {
	eager: true,
	import: 'default'
}) as Record<string, SourceManifest>;
const contentLoaders = import.meta.glob<ReadingSection>(
	'./catalog-data/sources/*/sections/*/content.json',
	{ import: 'default' }
);
const wordHelpLoaders = import.meta.glob<WordHelpAnnotation[]>(
	'./catalog-data/sources/*/sections/*/word-help.json',
	{ import: 'default' }
);

function packagePath(sourceId: string, sectionId?: string): string {
	return sectionId
		? `./catalog-data/sources/${sourceId}/sections/${sectionId}`
		: `./catalog-data/sources/${sourceId}/manifest.json`;
}

export const catalog: CatalogSource[] = (catalogIndex as Omit<CatalogSource, 'sections'>[])
	.map((entry) => {
		const manifest = manifests[packagePath(entry.id)];
		if (!manifest) throw new Error(`Catalog index references a missing source: ${entry.id}`);
		return { ...entry, sections: manifest.sections };
	})
	.sort((left, right) => left.id.localeCompare(right.id));

export function findSource(id: string | null): CatalogSource | undefined {
	return catalog.find((source) => source.id === id);
}

export function findSection(source: CatalogSource, id: string | null): SectionMetadata | undefined {
	return source.sections.find((section) => section.id === id);
}

export async function loadSection(sourceId: string, sectionId: string): Promise<LoadedSection> {
	const base = packagePath(sourceId, sectionId);
	const loadContent = contentLoaders[`${base}/content.json`];
	const loadWordHelp = wordHelpLoaders[`${base}/word-help.json`];
	if (!loadContent || !loadWordHelp)
		throw new Error(`Missing section package: ${sourceId}/${sectionId}`);
	const [content, wordHelp] = await Promise.all([loadContent(), loadWordHelp()]);
	return { content, wordHelp };
}

export function sourceText(source: ReadingSource): string {
	return source.sections.map((section) => section.text).join('\n\n');
}
