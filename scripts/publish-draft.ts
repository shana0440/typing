import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { analyzeImportDraft, completedBlockCount } from '../src/lib/importer/analyze.ts';
import { TerminalAnalysisProgress } from '../src/lib/importer/analysis-progress.ts';
import { draftSourceBlocks, readImportDraft, writeImportDraft } from '../src/lib/importer/draft.ts';
import { ImportError } from '../src/lib/importer/extract.ts';
import { listCodexModels } from '../src/lib/importer/models.ts';
import { startPreview } from '../src/lib/importer/preview.ts';
import { publishDraft } from '../src/lib/importer/publish.ts';

function workflowArguments(args: string[]): {
	draftPath: string;
	catalogPath: string;
	model?: string;
} {
	const [draftPath, ...options] = args;
	if (!draftPath) {
		throw new ImportError(
			'Usage: bun run publish:draft <draft.json> [--model <model>] [--catalog-file <catalog.json>]'
		);
	}

	let catalogPath = 'src/lib/catalog-data/catalog.json';
	let model: string | undefined;
	for (let index = 0; index < options.length; index += 1) {
		if (!options[index + 1]) {
			throw new ImportError(
				'Usage: bun run publish:draft <draft.json> [--model <model>] [--catalog-file <catalog.json>]'
			);
		}
		if (options[index] === '--catalog-file') catalogPath = options[index + 1];
		else if (options[index] === '--model') model = options[index + 1];
		else
			throw new ImportError(
				'Usage: bun run publish:draft <draft.json> [--model <model>] [--catalog-file <catalog.json>]'
			);
		index += 1;
	}
	return { draftPath: resolve(draftPath), catalogPath: resolve(catalogPath), model };
}

async function confirmed(question: string, terminal: ReturnType<typeof createInterface>) {
	const answer = await terminal.question(`${question} Type "yes" to confirm: `);
	return answer.trim().toLowerCase() === 'yes';
}

async function selectModel(
	terminal: ReturnType<typeof createInterface>,
	savedModel: string | null | undefined
): Promise<string> {
	const models = await listCodexModels();
	console.log('\nAvailable Codex models:');
	for (const [index, model] of models.entries()) {
		const labels = [
			model.isDefault ? 'Codex default' : '',
			model.model === savedModel ? 'previous' : ''
		]
			.filter(Boolean)
			.join(', ');
		console.log(
			`  ${index + 1}. ${model.displayName} (${model.model})${labels ? ` [${labels}]` : ''}\n     ${model.description}`
		);
	}
	const preferred = Math.max(
		0,
		models.findIndex((model) => model.model === savedModel) >= 0
			? models.findIndex((model) => model.model === savedModel)
			: models.findIndex((model) => model.isDefault)
	);

	while (true) {
		const answer = (await terminal.question(`Select a model [${preferred + 1}]: `)).trim();
		const selection = answer === '' ? preferred : Number(answer) - 1;
		if (Number.isInteger(selection) && selection >= 0 && selection < models.length) {
			return models[selection].model;
		}
		console.log(`Choose a number from 1 to ${models.length}.`);
	}
}

async function main() {
	const {
		draftPath,
		catalogPath,
		model: requestedModel
	} = workflowArguments(process.argv.slice(2));
	const draft = await readImportDraft(draftPath);
	const terminal = createInterface({ input: process.stdin, output: process.stdout });
	const savedModel = draft.analysisProgress?.lastModel;
	const blocks = draftSourceBlocks(draft);
	const savedBlocks = completedBlockCount(draft);
	const model =
		(requestedModel ??
			(savedBlocks < blocks.length ? await selectModel(terminal, savedModel) : savedModel)) ||
		savedModel ||
		undefined;
	console.log(`Using Codex model: ${model ?? 'configured default'}`);
	const progress = new TerminalAnalysisProgress(blocks.length, savedBlocks);
	try {
		const result = await analyzeImportDraft(draft, {
			model,
			onEvent: (event) => progress.event(event),
			onBlockStart: (index) => progress.paragraph(index),
			onCheckpoint: async (checkpoint) => {
				draft.annotations = checkpoint.annotations;
				draft.analysisProgress = {
					sourceDigest: checkpoint.sourceDigest,
					completedBlocks: checkpoint.completedBlocks,
					lastModel: checkpoint.lastModel
				};
				draft.status = 'draft';
				draft.redistributionConfirmed = false;
				await writeImportDraft(draftPath, draft);
				progress.checkpoint(checkpoint.completedBlocks.length);
			}
		});
		draft.annotations = result.annotations;
		draft.analysisProgress = {
			sourceDigest: result.sourceDigest,
			completedBlocks: result.completedBlocks,
			lastModel: result.lastModel
		};
		progress.complete();
	} catch (error) {
		progress.fail();
		terminal.close();
		throw error;
	}
	draft.status = 'analyzed';
	draft.redistributionConfirmed = false;
	await writeImportDraft(draftPath, draft);

	const preview = await startPreview(draft);
	console.log(`Review the complete Import Draft at ${preview.url}`);
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
