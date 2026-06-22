import { describe, expect, it } from 'vitest';
import { catalog, type ReadingSection } from './catalog';
import {
	PROGRESS_STORAGE_KEY,
	clearSectionProgress,
	mostRecentSection,
	progressForSection,
	readProgress,
	saveSectionProgress,
	sourceProgress
} from './progress';

function memoryStorage(initial?: string) {
	let value = initial ?? null;
	return {
		getItem: (key: string) => {
			void key;
			return value;
		},
		setItem: (key: string, next: string) => {
			void key;
			value = next;
		}
	};
}

const first: ReadingSection = { id: 'section-2', title: 'Chapter 1', text: 'First section.' };
const second: ReadingSection = { id: 'section-3', title: 'Chapter 2', text: 'Second section.' };

describe('section Reading Progress', () => {
	it('falls back safely for corrupt and incompatible data', () => {
		expect(readProgress(memoryStorage('{broken'))).toEqual({ version: 2, sources: {} });
		expect(readProgress(memoryStorage(JSON.stringify({ version: 1, sources: {} })))).toEqual({
			version: 2,
			sources: {}
		});
	});

	it('saves, restores, and clears sections independently', () => {
		const storage = memoryStorage();
		const sourceId = catalog[0].id;
		saveSectionProgress(storage, sourceId, first, 6, '2026-06-19T12:00:00.000Z');
		saveSectionProgress(
			storage,
			sourceId,
			second,
			second.text.length,
			'2026-06-20T12:00:00.000Z',
			'2026-06-20T12:00:00.000Z'
		);
		const progress = readProgress(storage);
		expect(progressForSection(progress, sourceId, first)?.position).toBe(6);
		expect(progressForSection(progress, sourceId, second)?.completedAt).not.toBeNull();

		clearSectionProgress(storage, sourceId, second.id);
		expect(progressForSection(readProgress(storage), sourceId, first)?.position).toBe(6);
		expect(progressForSection(readProgress(storage), sourceId, second)).toBeUndefined();
		expect(storage.getItem(PROGRESS_STORAGE_KEY)).not.toBeNull();
	});

	it('derives latest section and aggregate source status', () => {
		const source = { ...catalog[0], sections: [first, second] };
		const storage = memoryStorage();
		saveSectionProgress(storage, source.id, first, 6, '2026-06-19T12:00:00.000Z');
		saveSectionProgress(
			storage,
			source.id,
			second,
			second.text.length,
			'2026-06-20T12:00:00.000Z',
			'2026-06-20T12:00:00.000Z'
		);
		const progress = readProgress(storage);
		expect(mostRecentSection(progress, source)?.sectionId).toBe(second.id);
		expect(sourceProgress(progress, source)).toEqual({
			completed: 1,
			inProgress: 1,
			percentage: 71
		});
	});

	it('rejects mid-word and inconsistent completion records', () => {
		const sourceId = catalog[0].id;
		const storage = memoryStorage();
		saveSectionProgress(storage, sourceId, first, 2, '2026-06-19T12:00:00.000Z');
		expect(progressForSection(readProgress(storage), sourceId, first)).toBeUndefined();
		saveSectionProgress(storage, sourceId, first, first.text.length, '2026-06-19T12:00:00.000Z');
		expect(progressForSection(readProgress(storage), sourceId, first)).toBeUndefined();
	});
});
