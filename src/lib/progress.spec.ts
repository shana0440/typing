import { describe, expect, it } from 'vitest';
import { catalog, sourceText } from './catalog';
import {
	PROGRESS_STORAGE_KEY,
	clearSourceProgress,
	progressForSource,
	readProgress,
	saveSourceProgress
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

describe('Reading Progress', () => {
	it('falls back safely for corrupt and incompatible data', () => {
		const corrupt = memoryStorage('{broken');
		const incompatible = memoryStorage(JSON.stringify({ version: 2, sources: {} }));

		expect(readProgress(corrupt)).toEqual({ version: 1, sources: {} });
		expect(readProgress(incompatible)).toEqual({ version: 1, sources: {} });
	});

	it('accepts completed word boundaries and rejects mid-word positions', () => {
		const source = catalog[0];
		const storage = memoryStorage();
		const afterFirstSpace = sourceText(source).indexOf(' ') + 1;

		saveSourceProgress(storage, source, 2, '2026-06-19T12:00:00.000Z');
		expect(progressForSource(readProgress(storage), source)).toBeUndefined();

		saveSourceProgress(storage, source, afterFirstSpace, '2026-06-19T12:00:00.000Z');
		expect(progressForSource(readProgress(storage), source)?.position).toBe(afterFirstSpace);

		clearSourceProgress(storage, source.id);
		expect(readProgress(storage).sources).toEqual({});
		expect(storage.getItem(PROGRESS_STORAGE_KEY)).not.toBeNull();
	});

	it('rejects completion records whose position and date disagree', () => {
		const source = catalog[0];
		const storage = memoryStorage(
			JSON.stringify({
				version: 1,
				sources: {
					[source.id]: {
						position: sourceText(source).length,
						lastActiveAt: '2026-06-19T12:00:00.000Z',
						completedAt: null
					}
				}
			})
		);

		expect(progressForSource(readProgress(storage), source)).toBeUndefined();
	});
});
