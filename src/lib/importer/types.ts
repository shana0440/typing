export type ImportBlock = {
	type: 'paragraph' | 'blockquote' | 'preformatted' | 'list-item' | 'figure-caption' | 'table-text';
	text: string;
};

export type ImportSection = {
	id: string;
	heading: string | null;
	blocks: ImportBlock[];
};

export type CandidateOrigin = 'readability' | 'semantic-article' | 'semantic-main' | 'body';

export type ExtractionCandidate = {
	id: string;
	origin: CandidateOrigin;
	label: string;
	score: number;
	sections: ImportSection[];
	characterCount: number;
	blockCount: number;
	warnings: string[];
};

export type MetadataSuggestion = {
	value: string;
	origin: string;
};

export type BlockedReason =
	| 'fetch-failed'
	| 'access-denied'
	| 'no-usable-candidate'
	| 'operator-rejected';

export type ImportDraft = {
	schemaVersion: 2;
	status: 'extracted' | 'verified' | 'analyzed' | 'blocked';
	id: string;
	metadata: {
		title: string;
		author: string | null;
		language: 'en';
		requestedUrl: string;
		finalUrl: string | null;
		canonicalUrl: string | null;
		/** Catalog compatibility: the final URL is the attributed source URL. */
		originalUrl: string;
		titleSuggestions: MetadataSuggestion[];
		authorSuggestions: MetadataSuggestion[];
	};
	candidates: ExtractionCandidate[];
	selectedCandidateId: string | null;
	source: { sections: ImportSection[] };
	blocked: { reason: BlockedReason; diagnostic: string } | null;
	diagnostics: {
		fetchedAt: string;
		httpStatus: number | null;
		contentType: string | null;
		redirected: boolean;
		messages: string[];
	};
	annotations: ImportAnnotation[];
	analysisProgress?: {
		sourceDigest: string;
		completedBlocks: string[];
		lastModel: string | null;
	};
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
