import { resolve } from 'node:path';
import { readImportDraft, writeImportDraft } from '../src/lib/importer/draft.ts';
import { ImportError } from '../src/lib/importer/extract.ts';
import { startSourceVerification } from '../src/lib/importer/verification.ts';

async function main() {
	const [input, ...extra] = process.argv.slice(2);
	if (!input || extra.length) throw new ImportError('Usage: bun run verify:source <draft.json>');
	const path = resolve(input);
	const draft = await readImportDraft(path);
	if (draft.status === 'blocked')
		throw new ImportError(`Import Draft is blocked (${draft.blocked?.reason}).`);
	const verification = await startSourceVerification(draft);
	console.log(`Compare the original page with Source Verification at ${verification.url}`);
	try {
		const result = await verification.result;
		await writeImportDraft(path, result);
		if (result.status === 'verified')
			console.log(`Source verified. Run: bun run publish:draft ${JSON.stringify(path)}`);
		else console.log('Source rejected. The blocked Import Draft and diagnostics were retained.');
	} finally {
		await verification.close();
	}
}

main().catch((error: unknown) => {
	console.error(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
