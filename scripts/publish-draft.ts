import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import {
	analyzeImportDraft,
	completedBlockCount,
	DEFAULT_ANALYSIS_BATCH_SIZE,
	DEFAULT_ANALYSIS_CONCURRENCY,
	validateAnalysisSettings
} from '../src/lib/importer/analyze.ts';
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
	concurrency: number;
	batchSize: number;
} {
	const usage =
		'Usage: bun run publish:draft <draft.json> [--model <model>] [--catalog-file <catalog.json>] [--concurrency <1-16>] [--batch-size <1-50>]';
	const [draftPath, ...options] = args;
	if (!draftPath) throw new ImportError(usage);

	let catalogPath = 'src/lib/catalog-data/catalog.json';
	let model: string | undefined;
	let concurrency = DEFAULT_ANALYSIS_CONCURRENCY;
	let batchSize = DEFAULT_ANALYSIS_BATCH_SIZE;
	for (let index = 0; index < options.length; index += 1) {
		if (!options[index + 1]) throw new ImportError(usage);
		if (options[index] === '--catalog-file') catalogPath = options[index + 1];
		else if (options[index] === '--model') model = options[index + 1];
		else if (options[index] === '--concurrency') concurrency = Number(options[index + 1]);
		else if (options[index] === '--batch-size') batchSize = Number(options[index + 1]);
		else throw new ImportError(usage);
		index += 1;
	}
	validateAnalysisSettings(concurrency, batchSize);
	return {
		draftPath: resolve(draftPath),
		catalogPath: resolve(catalogPath),
		model,
		concurrency,
		batchSize
	};
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
		model: requestedModel,
		concurrency,
		batchSize
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
	const cancellation = new AbortController();
	let interrupted = false;
	const interrupt = () => {
		if (interrupted) return;
		interrupted = true;
		cancellation.abort();
	};
	process.once('SIGINT', interrupt);
	try {
		const result = await analyzeImportDraft(draft, {
			model,
			concurrency,
			batchSize,
			signal: cancellation.signal,
			onAnalysisEvent: (event) => progress.event(event),
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
		if (interrupted) {
			progress.interrupted();
			const resume = [
				'bun run publish:draft',
				JSON.stringify(draftPath),
				...(model ? ['--model', JSON.stringify(model)] : []),
				'--catalog-file',
				JSON.stringify(catalogPath),
				'--concurrency',
				String(concurrency),
				'--batch-size',
				String(batchSize)
			].join(' ');
			console.log(`Resume with: ${resume}`);
		} else progress.fail();
		terminal.close();
		throw error;
	} finally {
		process.removeListener('SIGINT', interrupt);
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
