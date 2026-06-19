import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createImportDraft, ImportError } from '../src/lib/importer/extract.ts';

function argumentsForImport(args: string[]): { url: string; draftDirectory: string } {
	const [url, ...options] = args;
	if (!url) throw new ImportError('Usage: bun run import:source <url> [--draft-dir <directory>]');

	let draftDirectory = '.imports/drafts';
	for (let index = 0; index < options.length; index += 1) {
		if (options[index] !== '--draft-dir' || !options[index + 1] || index + 2 !== options.length) {
			throw new ImportError('Usage: bun run import:source <url> [--draft-dir <directory>]');
		}
		draftDirectory = options[index + 1];
		index += 1;
	}
	return { url, draftDirectory };
}

async function main() {
	const { url, draftDirectory } = argumentsForImport(process.argv.slice(2));
	const draft = await createImportDraft(url);
	const outputDirectory = resolve(draftDirectory);
	const outputPath = resolve(outputDirectory, `${draft.id}.json`);
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'w'
	});
	console.log(`Import Draft written to ${outputPath}`);
	console.log('Review only: this source has not been Published to the Catalog.');
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Import failed: ${message}`);
	process.exitCode = 1;
});
