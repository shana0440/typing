import type { CatalogSource, ReadingSection } from './catalog';

export const PROGRESS_STORAGE_KEY = 'typing-practice:reading-progress';
const PROGRESS_VERSION = 2;

export type SectionProgress = {
	position: number;
	textLength: number;
	lastActiveAt: string;
	completedAt: string | null;
};

export type ReadingProgress = {
	version: typeof PROGRESS_VERSION;
	sources: Record<string, { sections: Record<string, SectionProgress> }>;
};

export function emptyProgress(): ReadingProgress {
	return { version: PROGRESS_VERSION, sources: {} };
}

function isDate(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseProgress(value: unknown): ReadingProgress | undefined {
	if (!value || typeof value !== 'object') return;
	const candidate = value as { version?: unknown; sources?: unknown };
	if (
		candidate.version !== PROGRESS_VERSION ||
		!candidate.sources ||
		typeof candidate.sources !== 'object'
	)
		return;

	const sources: ReadingProgress['sources'] = {};
	for (const [sourceId, sourceValue] of Object.entries(candidate.sources)) {
		if (!sourceValue || typeof sourceValue !== 'object') continue;
		const candidateSections = (sourceValue as { sections?: unknown }).sections;
		if (!candidateSections || typeof candidateSections !== 'object') continue;
		const sections: Record<string, SectionProgress> = {};
		for (const [sectionId, value] of Object.entries(candidateSections)) {
			if (!value || typeof value !== 'object') continue;
			const record = value as Partial<SectionProgress>;
			if (
				typeof record.position !== 'number' ||
				!Number.isInteger(record.position) ||
				typeof record.textLength !== 'number' ||
				!Number.isInteger(record.textLength) ||
				record.textLength <= 0 ||
				record.position < 0 ||
				record.position > record.textLength ||
				!isDate(record.lastActiveAt) ||
				!(record.completedAt === null || isDate(record.completedAt))
			)
				continue;
			sections[sectionId] = record as SectionProgress;
		}
		sources[sourceId] = { sections };
	}
	return { version: PROGRESS_VERSION, sources };
}

export function readProgress(storage: Pick<Storage, 'getItem'>): ReadingProgress {
	try {
		const stored = storage.getItem(PROGRESS_STORAGE_KEY);
		return stored ? (parseProgress(JSON.parse(stored)) ?? emptyProgress()) : emptyProgress();
	} catch {
		return emptyProgress();
	}
}

function writeProgress(storage: Pick<Storage, 'setItem'>, progress: ReadingProgress): void {
	try {
		storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
	} catch {
		// Storage can be unavailable or full; the Typing Session must remain usable.
	}
}

export function isWordBoundary(text: string, position: number): boolean {
	return (
		Number.isInteger(position) &&
		position >= 0 &&
		position <= text.length &&
		(position === 0 || position === text.length || /\s/.test(text[position - 1]))
	);
}

export function progressForSection(
	progress: ReadingProgress,
	sourceId: string,
	section: Pick<ReadingSection, 'id' | 'text'>
): SectionProgress | undefined {
	const saved = progress.sources[sourceId]?.sections[section.id];
	if (
		!saved ||
		saved.textLength !== section.text.length ||
		!isWordBoundary(section.text, saved.position)
	)
		return;
	if ((saved.position === section.text.length) !== (saved.completedAt !== null)) return;
	return saved;
}

export function savedSections(
	progress: ReadingProgress,
	sourceId: string
): Record<string, SectionProgress> {
	return progress.sources[sourceId]?.sections ?? {};
}

export function mostRecentSection(
	progress: ReadingProgress,
	source: CatalogSource
): (SectionProgress & { sectionId: string }) | undefined {
	return source.sections
		.flatMap(({ id }) => {
			const saved = savedSections(progress, source.id)[id];
			return saved ? [{ ...saved, sectionId: id }] : [];
		})
		.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0];
}

export function sourceProgress(
	progress: ReadingProgress,
	source: CatalogSource
): { completed: number; inProgress: number; percentage: number } {
	const records = source.sections.map(({ id }) => savedSections(progress, source.id)[id]);
	const completed = records.filter((record) => record?.completedAt).length;
	const inProgress = records.filter((record) => record && !record.completedAt).length;
	const total = records.reduce(
		(sum, record) => sum + (record ? record.position / record.textLength : 0),
		0
	);
	return {
		completed,
		inProgress,
		percentage: Math.round((total / source.sections.length) * 100)
	};
}

export function saveSectionProgress(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	sourceId: string,
	section: ReadingSection,
	position: number,
	now: string,
	completedAt: string | null = null
): void {
	if (!isWordBoundary(section.text, position)) return;
	const progress = readProgress(storage);
	progress.sources[sourceId] ??= { sections: {} };
	progress.sources[sourceId].sections[section.id] = {
		position,
		textLength: section.text.length,
		lastActiveAt: now,
		completedAt
	};
	writeProgress(storage, progress);
}

export function clearSectionProgress(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	sourceId: string,
	sectionId: string
): void {
	const progress = readProgress(storage);
	delete progress.sources[sourceId]?.sections[sectionId];
	writeProgress(storage, progress);
}
