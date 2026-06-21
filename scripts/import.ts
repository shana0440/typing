import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createImportAttempt, ImportError } from '../src/lib/importer/extract.ts';

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
	const { draft, snapshot } = await createImportAttempt(url);
	const outputDirectory = resolve(draftDirectory);
	const outputPath = resolve(outputDirectory, `${draft.id}.json`);
	const artifactDirectory = resolve(outputDirectory, `${draft.id}.artifacts`);
	await mkdir(outputDirectory, { recursive: true });
	await mkdir(artifactDirectory, { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'w'
	});
	if (snapshot !== null) await writeFile(join(artifactDirectory, 'raw.html'), snapshot, 'utf8');
	await writeFile(
		join(artifactDirectory, 'diagnostics.json'),
		`${JSON.stringify({ metadata: draft.metadata, blocked: draft.blocked, diagnostics: draft.diagnostics, candidates: draft.candidates.map((candidate) => ({ id: candidate.id, origin: candidate.origin, label: candidate.label, score: candidate.score, characterCount: candidate.characterCount, blockCount: candidate.blockCount, warnings: candidate.warnings })) }, null, 2)}\n`,
		'utf8'
	);
	console.log(`Import Draft written to ${outputPath}`);
	console.log(`Local diagnostics retained in ${artifactDirectory}`);
	if (draft.status === 'blocked') {
		console.log(`Import blocked (${draft.blocked?.reason}): ${draft.blocked?.diagnostic}`);
		return;
	}
	console.log(`Run: bun run verify:source ${JSON.stringify(outputPath)}`);
	console.log('Source Verification is required before Codex analysis.');
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Import failed: ${message}`);
	process.exitCode = 1;
});
