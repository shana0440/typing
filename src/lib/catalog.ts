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
};

export type ReadingSource = {
	id: string;
	title: string;
	author: string;
	sections: ReadingSection[];
	wordHelp: WordHelpAnnotation[];
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
		],
		wordHelp: [
			{
				id: 'opened',
				start: 5,
				end: 11,
				sentenceStart: 0,
				sentenceEnd: 38,
				explanationZhTw: '在此表示把原本關著的窗戶打開，讓空氣進入。',
				generatedExample: 'She opened the door to let the evening breeze inside.'
			},
			{
				id: 'before-sunrise',
				start: 23,
				end: 37,
				sentenceStart: 0,
				sentenceEnd: 38,
				explanationZhTw: '「before sunrise」指日出以前，也就是天色仍暗的清晨時段。',
				generatedExample: 'The hikers left camp before sunrise to avoid the heat.'
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
