export type ReadingSection = {
	id: string;
	title: string;
	text: string;
};

export type ReadingSource = {
	id: string;
	title: string;
	author: string;
	sections: ReadingSection[];
};

export const catalog: ReadingSource[] = [
	{
		id: 'the-window-light',
		title: 'The Window Light',
		author: 'Typing Practice',
		sections: [
			{
				id: 'chapter-one',
				title: 'Chapter One',
				text: 'Mara opened the window before sunrise. The street below was quiet, and the cool air smelled of rain.\n\nShe set a small lamp beside her book. Soon, a warm square of light rested on every page.'
			}
		]
	}
];

export function findSource(id: string | null): ReadingSource | undefined {
	return catalog.find((source) => source.id === id);
}

export function sourceText(source: ReadingSource): string {
	return source.sections.map((section) => section.text).join('\n\n');
}
