import type { ReadingSection, ReadingSource, WordHelpAnnotation } from './catalog';

export type SourceManifest = Omit<ReadingSource, 'sections' | 'wordHelp'> & {
	sectionIds: string[];
};

export type PackagedSection = {
	content: ReadingSection;
	wordHelp: WordHelpAnnotation[];
};

export type SourcePackage = {
	manifest: SourceManifest;
	sections: Record<string, PackagedSection>;
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

export function assembleSourcePackage(sourcePackage: SourcePackage): ReadingSource {
	const { manifest, sections } = sourcePackage;
	if (!manifest.id || manifest.language !== 'en' || manifest.sectionIds.length === 0) {
		throw new Error(`Invalid source manifest: ${manifest.id || '<missing id>'}`);
	}
	if (new Set(manifest.sectionIds).size !== manifest.sectionIds.length) {
		throw new Error(`Source manifest has duplicate section IDs: ${manifest.id}`);
	}

	let offset = 0;
	const assembledSections: ReadingSection[] = [];
	const wordHelp: WordHelpAnnotation[] = [];
	for (const sectionId of manifest.sectionIds) {
		const section = sections[sectionId];
		if (!section || section.content.id !== sectionId || typeof section.content.text !== 'string') {
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
		id: manifest.id,
		title: manifest.title,
		author: manifest.author,
		language: manifest.language,
		originalUrl: manifest.originalUrl,
		sections: assembledSections,
		wordHelp
	};
}
