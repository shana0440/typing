import type { ReadingSection, WordHelpAnnotation } from './catalog';

export type SourceManifest = {
	id: string;
	title: string;
	author: string;
	language: 'en';
	originalUrl: string | null;
	sections: Array<Pick<ReadingSection, 'id' | 'title'>>;
};

export type PackagedSection = {
	content: ReadingSection;
	wordHelp: WordHelpAnnotation[];
};

export type SourcePackage = {
	manifest: SourceManifest;
	sections: Record<string, PackagedSection>;
};

type AssembledReadingSource = Omit<SourceManifest, 'sections'> & {
	sections: ReadingSection[];
	wordHelp: WordHelpAnnotation[];
};

function assertSpan(annotation: WordHelpAnnotation, text: string, sectionId: string): void {
	if (
		!Number.isInteger(annotation.start) ||
		!Number.isInteger(annotation.end) ||
		annotation.start < 0 ||
		annotation.end <= annotation.start ||
		annotation.end > text.length ||
		annotation.sentenceStart < 0 ||
		annotation.sentenceStart > annotation.start ||
		annotation.sentenceEnd < annotation.end ||
		annotation.sentenceEnd > text.length
	) {
		throw new Error(`Invalid Word Help span in section ${sectionId}: ${annotation.id}`);
	}
}

export function assembleSourcePackage(sourcePackage: SourcePackage): AssembledReadingSource {
	const { manifest, sections } = sourcePackage;
	if (!manifest.id || manifest.language !== 'en' || manifest.sections.length === 0) {
		throw new Error(`Invalid source manifest: ${manifest.id || '<missing id>'}`);
	}
	if (new Set(manifest.sections.map(({ id }) => id)).size !== manifest.sections.length) {
		throw new Error(`Source manifest has duplicate section IDs: ${manifest.id}`);
	}

	let offset = 0;
	const assembledSections: ReadingSection[] = [];
	const wordHelp: WordHelpAnnotation[] = [];
	for (const metadata of manifest.sections) {
		const sectionId = metadata.id;
		const section = sections[sectionId];
		if (
			!section ||
			section.content.id !== sectionId ||
			section.content.title !== metadata.title ||
			typeof section.content.text !== 'string'
		) {
			throw new Error(`Missing or invalid section ${sectionId} in source ${manifest.id}`);
		}
		assembledSections.push(section.content);
		for (const annotation of section.wordHelp) {
			assertSpan(annotation, section.content.text, sectionId);
			wordHelp.push({
				...annotation,
				start: annotation.start + offset,
				end: annotation.end + offset,
				sentenceStart: annotation.sentenceStart + offset,
				sentenceEnd: annotation.sentenceEnd + offset
			});
		}
		offset += section.content.text.length + 2;
	}

	return {
		...manifest,
		sections: assembledSections,
		wordHelp
	};
}
