import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateCatalog, validateCatalog } from '../../scripts/catalog';
import type { ReadingSource } from './catalog';

function legacySource(): ReadingSource {
	return {
		id: 'legacy-source',
		title: 'Legacy Source',
		author: 'Author',
		language: 'en',
		originalUrl: null,
		sections: [
			{ id: 'one', title: 'One', text: 'First.' },
			{ id: 'two', title: 'Two', text: 'Second term.' }
		],
		wordHelp: [
			{
				id: 'term',
				start: 15,
				end: 19,
				sentenceStart: 8,
				sentenceEnd: 20,
				explanationZhTw: '詞',
				generatedExample: 'A term.',
				category: 'term',
				cefrLevel: 'A2'
			}
		]
	};
}

describe('Catalog migration', () => {
	it('writes deterministic packages with section-local Word Help and a generated index', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'typing-catalog-migration-'));
		const legacyPath = join(directory, 'catalog.json');
		const packageRoot = join(directory, 'packaged');
		await writeFile(legacyPath, `${JSON.stringify([legacySource()])}\n`);

		await migrateCatalog(legacyPath, packageRoot);
		await validateCatalog(packageRoot);
		const firstIndex = await readFile(join(packageRoot, 'index.json'), 'utf8');
		const wordHelpPath = join(
			packageRoot,
			'sources',
			'legacy-source',
			'sections',
			'two',
			'word-help.json'
		);
		expect(JSON.parse(await readFile(wordHelpPath, 'utf8'))[0]).toMatchObject({
			start: 7,
			end: 11,
			sentenceStart: 0,
			sentenceEnd: 12
		});

		await migrateCatalog(legacyPath, packageRoot);
		expect(await readFile(join(packageRoot, 'index.json'), 'utf8')).toBe(firstIndex);
	});

	it('rejects Word Help that crosses section boundaries', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'typing-catalog-invalid-'));
		const legacyPath = join(directory, 'catalog.json');
		const source = legacySource();
		source.wordHelp[0] = { ...source.wordHelp[0], start: 5, end: 9 };
		await writeFile(legacyPath, JSON.stringify([source]));

		await expect(migrateCatalog(legacyPath, join(directory, 'packaged'))).rejects.toThrow(
			'crosses a section boundary'
		);
	});
});
