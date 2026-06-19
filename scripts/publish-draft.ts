import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { analyzeImportDraft } from '../src/lib/importer/analyze.ts';
import { readImportDraft, writeImportDraft } from '../src/lib/importer/draft.ts';
import { ImportError } from '../src/lib/importer/extract.ts';
import { startPreview } from '../src/lib/importer/preview.ts';
import { publishDraft } from '../src/lib/importer/publish.ts';

function workflowArguments(args: string[]): { draftPath: string; catalogPath: string } {
	const [draftPath, ...options] = args;
	if (!draftPath) {
		throw new ImportError(
			'Usage: bun run publish:draft <draft.json> [--catalog-file <catalog.json>]'
		);
	}

	let catalogPath = 'src/lib/catalog-data/catalog.json';
	for (let index = 0; index < options.length; index += 1) {
		if (
			options[index] !== '--catalog-file' ||
			!options[index + 1] ||
			index + 2 !== options.length
		) {
			throw new ImportError(
				'Usage: bun run publish:draft <draft.json> [--catalog-file <catalog.json>]'
			);
		}
		catalogPath = options[index + 1];
		index += 1;
	}
	return { draftPath: resolve(draftPath), catalogPath: resolve(catalogPath) };
}

async function confirmed(question: string, terminal: ReturnType<typeof createInterface>) {
	const answer = await terminal.question(`${question} Type "yes" to confirm: `);
	return answer.trim().toLowerCase() === 'yes';
}

async function main() {
	const { draftPath, catalogPath } = workflowArguments(process.argv.slice(2));
	const draft = await readImportDraft(draftPath);
	console.log('Analyzing exact source with the locally authenticated Codex CLI...');
	draft.annotations = await analyzeImportDraft(draft);
	draft.status = 'analyzed';
	draft.redistributionConfirmed = false;
	await writeImportDraft(draftPath, draft);

	const preview = await startPreview(draft);
	console.log(`Review the complete Import Draft at ${preview.url}`);
	const terminal = createInterface({ input: process.stdin, output: process.stdout });
	try {
		if (!(await confirmed('Is the extracted source and every annotation accurate?', terminal))) {
			console.log('Publish rejected. The analyzed Import Draft was retained for inspection.');
			return;
		}
		if (
			!(await confirmed(
				'Are you authorized to redistribute this complete Reading Source?',
				terminal
			))
		) {
			console.log('Publish rejected. The analyzed Import Draft was retained for inspection.');
			return;
		}

		draft.redistributionConfirmed = true;
		await writeImportDraft(draftPath, draft);
		await publishDraft(draft, catalogPath);
		console.log(`Published ${draft.metadata.title} to ${catalogPath}`);
		console.log('Files were written only. Review the Git diff and commit manually.');
	} finally {
		terminal.close();
		await preview.close();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Publish failed: ${message}`);
	process.exitCode = 1;
});
