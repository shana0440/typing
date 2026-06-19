import { sourceText, type ReadingSource } from './catalog';

export const PROGRESS_STORAGE_KEY = 'typing-practice:reading-progress';
const PROGRESS_VERSION = 1;

export type SourceProgress = {
	position: number;
	lastActiveAt: string;
	completedAt: string | null;
};

export type ReadingProgress = {
	version: typeof PROGRESS_VERSION;
	sources: Record<string, SourceProgress>;
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
	) {
		return;
	}

	const sources: Record<string, SourceProgress> = {};
	for (const [id, value] of Object.entries(candidate.sources)) {
		if (!value || typeof value !== 'object') continue;
		const record = value as Partial<SourceProgress>;
		if (
			typeof record.position !== 'number' ||
			!Number.isInteger(record.position) ||
			!isDate(record.lastActiveAt) ||
			!(record.completedAt === null || isDate(record.completedAt))
		) {
			continue;
		}
		sources[id] = record as SourceProgress;
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

export function progressForSource(
	progress: ReadingProgress,
	source: ReadingSource
): SourceProgress | undefined {
	const saved = progress.sources[source.id];
	const textLength = sourceText(source).length;
	if (!saved || !isWordBoundary(sourceText(source), saved.position)) return;
	if ((saved.position === textLength) !== (saved.completedAt !== null)) return;
	return saved;
}

export function saveSourceProgress(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	source: ReadingSource,
	position: number,
	now: string,
	completedAt: string | null = null
): void {
	const text = sourceText(source);
	if (!isWordBoundary(text, position)) return;
	const progress = readProgress(storage);
	progress.sources[source.id] = { position, lastActiveAt: now, completedAt };
	writeProgress(storage, progress);
}

export function clearSourceProgress(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	sourceId: string
): void {
	const progress = readProgress(storage);
	delete progress.sources[sourceId];
	writeProgress(storage, progress);
}
