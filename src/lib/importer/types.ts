export type ImportBlock = {
	type: 'paragraph' | 'blockquote' | 'preformatted' | 'list-item';
	text: string;
};

export type ImportSection = {
	id: string;
	heading: string | null;
	blocks: ImportBlock[];
};

export type ImportDraft = {
	schemaVersion: 1;
	status: 'draft' | 'analyzed';
	id: string;
	metadata: {
		title: string;
		author: string | null;
		language: 'en';
		originalUrl: string;
	};
	source: {
		sections: ImportSection[];
	};
	annotations: ImportAnnotation[];
	redistributionConfirmed: boolean;
};

export type ImportAnnotation = {
	id: string;
	start: number;
	end: number;
	sentenceStart: number;
	sentenceEnd: number;
	explanationZhTw: string;
	generatedExample: string;
	category: 'term' | 'idiom' | 'phrasal-verb' | 'contextual-meaning';
	cefrLevel: 'B2' | 'C1' | 'C2' | null;
};
