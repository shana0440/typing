import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { draftSourceBlocks, type DraftSourceBlock } from './draft.ts';
import { ImportError } from './extract.ts';
import type { ImportAnnotation, ImportDraft } from './types.ts';

const categories = ['term', 'idiom', 'phrasal-verb', 'contextual-meaning'] as const;
const cefrLevels = ['A2', 'B1', 'B2', 'C1', 'C2'] as const;
const annotationKeys = [
	'category',
	'cefrLevel',
	'end',
	'explanationZhTw',
	'generatedExample',
	'id',
	'sentenceEnd',
	'sentenceStart',
	'start'
];
const resultKeys = ['annotations', 'key', 'sourceText'];
export const DEFAULT_ANALYSIS_CONCURRENCY = 3;
export const DEFAULT_ANALYSIS_BATCH_SIZE = 3;
export const MAX_BATCH_CHARACTERS = 24_000;

const annotationSchema = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		start: { type: 'integer' },
		end: { type: 'integer' },
		sentenceStart: { type: 'integer' },
		sentenceEnd: { type: 'integer' },
		explanationZhTw: { type: 'string' },
		generatedExample: { type: 'string' },
		category: { type: 'string', enum: categories },
		cefrLevel: { type: ['string', 'null'], enum: [...cefrLevels, null] }
	},
	required: annotationKeys,
	additionalProperties: false
};
const analysisSchema = {
	type: 'object',
	properties: {
		results: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					key: { type: 'string' },
					sourceText: { type: 'string' },
					annotations: { type: 'array', items: annotationSchema }
				},
				required: resultKeys,
				additionalProperties: false
			}
		}
	},
	required: ['results'],
	additionalProperties: false
};

type BlockAnalysisOutput = { key: string; sourceText: string; annotations: unknown[] };
export type AnalysisCheckpoint = NonNullable<ImportDraft['analysisProgress']> & {
	annotations: ImportAnnotation[];
};
export type AnalysisEvent =
	| { type: 'batch-start'; activeBatches: number }
	| { type: 'batch-complete'; keys: string[]; completedBlocks: number; activeBatches: number }
	| {
			type: 'batch-retry';
			keys: string[];
			retryCount: number;
			activeBatches: number;
			error: string;
	  }
	| { type: 'batch-failure'; keys: string[]; activeBatches: number; error: string };
export type AnalysisOptions = {
	codexCommand?: string;
	model?: string;
	concurrency?: number;
	batchSize?: number;
	signal?: AbortSignal;
	retryDelayMs?: number;
	onAnalysisEvent?: (event: AnalysisEvent) => void;
	onCheckpoint?: (checkpoint: AnalysisCheckpoint) => Promise<void>;
};

function sourceDigest(draft: ImportDraft): string {
	return createHash('sha256').update(JSON.stringify(draft.source)).digest('hex');
}

export function completedBlockCount(draft: ImportDraft): number {
	if (draft.analysisProgress?.sourceDigest !== sourceDigest(draft)) return 0;
	const blockKeys = new Set(draftSourceBlocks(draft).map((block) => block.key));
	return draft.analysisProgress.completedBlocks.filter((key) => blockKeys.has(key)).length;
}

export function validateAnalysisSettings(concurrency: number, batchSize: number): void {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
		throw new ImportError('Concurrency must be an integer from 1 through 16.');
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 50)
		throw new ImportError('Batch size must be an integer from 1 through 50.');
}

export function partitionAnalysisBatches(
	blocks: DraftSourceBlock[],
	batchSize = DEFAULT_ANALYSIS_BATCH_SIZE,
	maxCharacters = MAX_BATCH_CHARACTERS
): DraftSourceBlock[][] {
	const batches: DraftSourceBlock[][] = [];
	let batch: DraftSourceBlock[] = [];
	let characters = 0;
	for (const block of blocks) {
		if (
			batch.length &&
			(batch.length >= batchSize || characters + block.text.length > maxCharacters)
		) {
			batches.push(batch);
			batch = [];
			characters = 0;
		}
		batch.push(block);
		characters += block.text.length;
		if (block.text.length > maxCharacters) {
			batches.push(batch);
			batch = [];
			characters = 0;
		}
	}
	if (batch.length) batches.push(batch);
	return batches;
}

function abortedError(): ImportError {
	return new ImportError('Codex analysis was interrupted.');
}

function runCodex(
	command: string,
	args: string[],
	prompt: string,
	signal?: AbortSignal
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortedError());
		const child: ChildProcess = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
		let stderr = '';
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolve();
		};
		const abort = () => {
			child.kill('SIGTERM');
			finish(abortedError());
		};
		signal?.addEventListener('abort', abort, { once: true });
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => (stderr += chunk));
		child.stdin?.on('error', () => {
			// Process termination is reported by the error or close handler.
		});
		child.on('error', (error) =>
			finish(new ImportError(`Could not start Codex CLI: ${error.message}`))
		);
		child.on('close', (code) => {
			if (signal?.aborted) finish(abortedError());
			else if (code === 0) finish();
			else
				finish(
					new ImportError(`Codex analysis failed${stderr.trim() ? `: ${stderr.trim()}` : '.'}`)
				);
		});
		child.stdin?.end(prompt);
	});
}

function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value);
}

function validateLocalAnnotation(value: unknown, text: string): ImportAnnotation {
	if (!value || typeof value !== 'object')
		throw new ImportError('Codex returned a malformed annotation.');
	const annotation = value as Partial<ImportAnnotation>;
	if (
		!isDeepStrictEqual(Object.keys(value).sort(), annotationKeys) ||
		typeof annotation.id !== 'string' ||
		!annotation.id.trim() ||
		!isInteger(annotation.start) ||
		!isInteger(annotation.end) ||
		!isInteger(annotation.sentenceStart) ||
		!isInteger(annotation.sentenceEnd) ||
		typeof annotation.explanationZhTw !== 'string' ||
		!annotation.explanationZhTw.trim() ||
		!/[\p{Script=Han}]/u.test(annotation.explanationZhTw) ||
		typeof annotation.generatedExample !== 'string' ||
		!annotation.generatedExample.trim() ||
		!categories.includes(annotation.category as (typeof categories)[number]) ||
		!(annotation.cefrLevel === null || cefrLevels.some((level) => level === annotation.cefrLevel))
	)
		throw new ImportError('Codex returned an annotation with missing or invalid fields.');
	if (
		annotation.start < 0 ||
		annotation.end > text.length ||
		annotation.start >= annotation.end ||
		annotation.sentenceStart < 0 ||
		annotation.sentenceEnd > text.length ||
		annotation.sentenceStart > annotation.start ||
		annotation.sentenceEnd < annotation.end ||
		annotation.sentenceStart >= annotation.sentenceEnd ||
		text.slice(annotation.start, annotation.end).trim() !==
			text.slice(annotation.start, annotation.end)
	)
		throw new ImportError(
			`Codex returned an invalid source span for annotation "${annotation.id}".`
		);
	return annotation as ImportAnnotation;
}

export function validateBlockAnalysis(block: DraftSourceBlock, value: unknown): ImportAnnotation[] {
	if (
		!value ||
		typeof value !== 'object' ||
		!isDeepStrictEqual(Object.keys(value).sort(), resultKeys)
	)
		throw new ImportError('Codex returned malformed JSON output.');
	const output = value as Partial<BlockAnalysisOutput>;
	if (output.key !== block.key)
		throw new ImportError(`Codex returned an unexpected block result "${output.key ?? ''}".`);
	if (output.sourceText !== block.text)
		throw new ImportError('Codex attempted to mutate or replace immutable source content.');
	if (!Array.isArray(output.annotations))
		throw new ImportError('Codex output is missing annotations.');
	const local = output.annotations.map((annotation) =>
		validateLocalAnnotation(annotation, block.text)
	);
	const byPosition = [...local].sort((left, right) => left.start - right.start);
	for (let index = 1; index < byPosition.length; index += 1)
		if (byPosition[index].start < byPosition[index - 1].end)
			throw new ImportError('Codex returned overlapping annotation spans.');
	return byPosition.map((annotation) => ({
		...annotation,
		id: `${block.key}-${annotation.id}`,
		start: annotation.start + block.globalStart,
		end: annotation.end + block.globalStart,
		sentenceStart: annotation.sentenceStart + block.globalStart,
		sentenceEnd: annotation.sentenceEnd + block.globalStart
	}));
}

export function validateBatchAnalysis(
	blocks: DraftSourceBlock[],
	value: unknown
): ImportAnnotation[] {
	if (!value || typeof value !== 'object' || !isDeepStrictEqual(Object.keys(value), ['results']))
		throw new ImportError('Codex returned malformed JSON output.');
	const results = (value as { results?: unknown }).results;
	if (!Array.isArray(results)) throw new ImportError('Codex output is missing block results.');
	const requested = new Map(blocks.map((block) => [block.key, block]));
	const seen = new Set<string>();
	const annotations: ImportAnnotation[] = [];
	for (const result of results) {
		const key =
			result && typeof result === 'object' ? (result as { key?: unknown }).key : undefined;
		if (typeof key !== 'string' || !requested.has(key))
			throw new ImportError(`Codex returned an unexpected block result "${String(key ?? '')}".`);
		if (seen.has(key)) throw new ImportError(`Codex returned a duplicate block result "${key}".`);
		seen.add(key);
		annotations.push(...validateBlockAnalysis(requested.get(key)!, result));
	}
	const missing = blocks.find((block) => !seen.has(block.key));
	if (missing) throw new ImportError(`Codex omitted block result "${missing.key}".`);
	return annotations.sort((left, right) => left.start - right.start);
}

function promptForBatch(draft: ImportDraft, blocks: DraftSourceBlock[]): string {
	return [
		'Analyze each exact English source block independently for contextual Word Help.',
		'Identify CEFR A2+ terms, idioms, phrasal verbs, and contextually unusual meanings.',
		'Return exactly one keyed result per source block, with Traditional Chinese explanations and one generated English example per annotation.',
		"All offsets are JavaScript UTF-16 indices local to that result's sourceText. Never span blocks.",
		'Copy every key and sourceText exactly. Never rewrite, correct, summarize, omit, duplicate, or mutate source content.',
		JSON.stringify({
			title: draft.metadata.title,
			blocks: blocks.map(({ key, sectionHeading, text }) => ({
				key,
				sectionHeading,
				sourceText: text
			}))
		})
	].join('\n\n');
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortedError());
		const timer = setTimeout(resolve, milliseconds);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(abortedError());
			},
			{ once: true }
		);
	});
}

export async function analyzeImportDraft(
	draft: ImportDraft,
	options: AnalysisOptions = {}
): Promise<AnalysisCheckpoint> {
	if (draft.status !== 'verified' && draft.status !== 'analyzed') {
		throw new ImportError('Codex analysis requires a verified Import Draft.');
	}
	const concurrency = options.concurrency ?? DEFAULT_ANALYSIS_CONCURRENCY;
	const batchSize = options.batchSize ?? DEFAULT_ANALYSIS_BATCH_SIZE;
	validateAnalysisSettings(concurrency, batchSize);
	const blocks = draftSourceBlocks(draft);
	const digest = sourceDigest(draft);
	const resumable = draft.analysisProgress?.sourceDigest === digest;
	const blockOrder = new Map(blocks.map((block, index) => [block.key, index]));
	const validKeys = new Set(blockOrder.keys());
	const initialCompleted = resumable
		? [...new Set(draft.analysisProgress!.completedBlocks.filter((key) => validKeys.has(key)))]
		: [];
	const completed = new Set(initialCompleted);
	let annotations = resumable ? [...draft.annotations] : [];
	const batches = partitionAnalysisBatches(
		blocks.filter((block) => !completed.has(block.key)),
		batchSize
	);
	const directory = await mkdtemp(join(tmpdir(), 'typing-codex-'));
	const schemaPath = join(directory, 'analysis-schema.json');
	let nextBatch = 0;
	let activeBatches = 0;
	let retryCount = 0;
	let failure: Error | undefined;
	let checkpointQueue = Promise.resolve();
	try {
		await writeFile(schemaPath, JSON.stringify(analysisSchema), 'utf8');
		const runBatch = async (batch: DraftSourceBlock[]) => {
			activeBatches += 1;
			options.onAnalysisEvent?.({ type: 'batch-start', activeBatches });
			try {
				for (let attempt = 0; attempt < 2; attempt += 1) {
					if (options.signal?.aborted) throw abortedError();
					const outputPath = join(directory, `${randomUUID()}.json`);
					try {
						const args = [
							'exec',
							'--json',
							'--ephemeral',
							'--sandbox',
							'read-only',
							'--output-schema',
							schemaPath,
							'-o',
							outputPath
						];
						if (options.model) args.push('--model', options.model);
						args.push('-');
						await runCodex(
							options.codexCommand ?? process.env.CODEX_COMMAND ?? 'codex',
							args,
							promptForBatch(draft, batch),
							options.signal
						);
						let output: unknown;
						try {
							output = JSON.parse(await readFile(outputPath, 'utf8'));
						} catch {
							throw new ImportError('Codex returned malformed JSON output.');
						}
						const batchAnnotations = validateBatchAnalysis(batch, output);
						checkpointQueue = checkpointQueue.then(async () => {
							annotations = [...annotations, ...batchAnnotations].sort(
								(left, right) => left.start - right.start || left.id.localeCompare(right.id)
							);
							for (const block of batch) completed.add(block.key);
							const completedBlocks = [...completed].sort(
								(left, right) => blockOrder.get(left)! - blockOrder.get(right)!
							);
							await options.onCheckpoint?.({
								sourceDigest: digest,
								completedBlocks,
								lastModel: options.model ?? null,
								annotations
							});
							options.onAnalysisEvent?.({
								type: 'batch-complete',
								keys: batch.map((block) => block.key),
								completedBlocks: completed.size,
								activeBatches: activeBatches - 1
							});
						});
						await checkpointQueue;
						return;
					} catch (error) {
						if (options.signal?.aborted) throw abortedError();
						if (attempt === 1) throw error;
						retryCount += 1;
						options.onAnalysisEvent?.({
							type: 'batch-retry',
							keys: batch.map((block) => block.key),
							retryCount,
							activeBatches,
							error: error instanceof Error ? error.message : String(error)
						});
						await delay(options.retryDelayMs ?? 2_000, options.signal);
					} finally {
						await rm(outputPath, { force: true });
					}
				}
			} finally {
				activeBatches -= 1;
			}
		};
		const worker = async () => {
			while (!failure && !options.signal?.aborted) {
				const index = nextBatch++;
				if (index >= batches.length) return;
				const batch = batches[index];
				try {
					await runBatch(batch);
				} catch (error) {
					failure = error instanceof Error ? error : new Error(String(error));
					options.onAnalysisEvent?.({
						type: 'batch-failure',
						keys: batch.map((block) => block.key),
						activeBatches,
						error: failure.message
					});
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
		await checkpointQueue;
		if (options.signal?.aborted) throw abortedError();
		if (failure) throw failure;
		return {
			sourceDigest: digest,
			completedBlocks: [...completed].sort(
				(left, right) => blockOrder.get(left)! - blockOrder.get(right)!
			),
			lastModel: options.model ?? draft.analysisProgress?.lastModel ?? null,
			annotations
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
