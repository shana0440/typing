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
	status: 'draft';
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
	annotations: [];
	redistributionConfirmed: false;
};
