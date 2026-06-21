import catalogData from './catalog-data/catalog.json';

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

export const catalog: ReadingSource[] = catalogData as ReadingSource[];

export function findSource(id: string | null): ReadingSource | undefined {
	return catalog.find((source) => source.id === id);
}

export function sourceText(source: ReadingSource): string {
	return source.sections.map((section) => section.text).join('\n\n');
}
