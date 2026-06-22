import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
	'explanationZhTw',
	'generatedExample',
	'id',
	'sentenceQuote',
	'sourceQuote'
];
const resultKeys = ['annotations', 'key'];
export const DEFAULT_ANALYSIS_CONCURRENCY = 1;
export const DEFAULT_ANALYSIS_BATCH_SIZE = 1;
export const MAX_BATCH_CHARACTERS = 24_000;
export const DEFAULT_ANALYSIS_REQUEST_TIMEOUT_MS = 10 * 60 * 1_000;

const annotationSchema = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		sourceQuote: { type: 'string' },
		sentenceQuote: { type: 'string' },
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

type BlockAnalysisOutput = { key: string; annotations: unknown[] };
type LocalAnnotationOutput = Omit<
	ImportAnnotation,
	'start' | 'end' | 'sentenceStart' | 'sentenceEnd'
> & {
	sourceQuote: string;
	sentenceQuote: string;
};
export type AnalysisCheckpoint = NonNullable<ImportDraft['analysisProgress']> & {
	annotations: ImportAnnotation[];
};
export type AnalysisEvent =
	| { type: 'batch-start'; activeBatches: number }
	| { type: 'batch-complete'; keys: string[]; completedBlocks: number; activeBatches: number }
	| { type: 'annotation-skipped'; keys: string[]; activeBatches: number; errors: string[] }
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
	requestTimeoutMs?: number;
	diagnosticDirectory?: string;
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
	signal: AbortSignal | undefined,
	workingDirectory: string,
	timeoutMs: number,
	diagnostics?: { eventsPath: string; stderrPath: string }
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortedError());
		const child: ChildProcess = spawn(command, args, {
			cwd: workingDirectory,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stderr = '';
		let stdoutBuffer = '';
		let eventError = '';
		let settled = false;
		const readEvents = (chunk: string, complete = false) => {
			stdoutBuffer += chunk;
			const lines = stdoutBuffer.split('\n');
			const remainder = lines.pop() ?? '';
			stdoutBuffer = complete ? '' : remainder;
			if (complete && remainder) lines.push(remainder);
			for (const line of lines) {
				try {
					const event = JSON.parse(line) as {
						type?: unknown;
						message?: unknown;
						error?: { message?: unknown };
					};
					const message =
						typeof event.error?.message === 'string'
							? event.error.message
							: typeof event.message === 'string'
								? event.message
								: '';
					if (message && (event.type === 'turn.failed' || event.type === 'error'))
						eventError = message;
				} catch {
					// Raw output remains available in the diagnostics file.
				}
			}
		};
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolve();
		};
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			finish(
				new ImportError(
					`Codex analysis request timed out after ${Math.round(timeoutMs / 1_000)} seconds.`
				)
			);
		}, timeoutMs);
		timeout.unref?.();
		const abort = () => {
			child.kill('SIGTERM');
			finish(abortedError());
		};
		signal?.addEventListener('abort', abort, { once: true });
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			if (diagnostics) appendFileSync(diagnostics.eventsPath, chunk, 'utf8');
			readEvents(chunk);
		});
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk;
			if (diagnostics) appendFileSync(diagnostics.stderrPath, chunk, 'utf8');
			if (/failed to parse function arguments/i.test(chunk)) {
				child.kill('SIGTERM');
				finish(
					new ImportError(
						'Codex emitted malformed tool-call arguments during output-only analysis.'
					)
				);
			}
		});
		child.stdin?.on('error', () => {
			// Process termination is reported by the error or close handler.
		});
		child.on('error', (error) =>
			finish(new ImportError(`Could not start Codex CLI: ${error.message}`))
		);
		child.on('close', (code) => {
			readEvents('', true);
			if (signal?.aborted) finish(abortedError());
			else if (code === 0) finish();
			else
				finish(
					new ImportError(
						`Codex analysis failed${stderr.trim() || eventError ? `: ${stderr.trim() || eventError}` : '.'}`
					)
				);
		});
		child.stdin?.end(prompt);
	});
}

type QuoteSpan = { start: number; end: number };

function quotePattern(quote: string): RegExp {
	const escaped = quote
		.split(/\s+/u)
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('\\s+');
	return new RegExp(escaped, 'gu');
}

function allQuoteSpans(text: string, quote: string): QuoteSpan[] {
	return [...text.matchAll(quotePattern(quote))].map((match) => ({
		start: match.index,
		end: match.index + match[0].length
	}));
}

function validateLocalAnnotation(value: unknown, text: string): ImportAnnotation[] {
	if (!value || typeof value !== 'object')
		throw new ImportError('Codex returned a malformed annotation.');
	const annotation = value as Partial<LocalAnnotationOutput>;
	if (
		!isDeepStrictEqual(Object.keys(value).sort(), annotationKeys) ||
		typeof annotation.id !== 'string' ||
		!annotation.id.trim() ||
		typeof annotation.sourceQuote !== 'string' ||
		!annotation.sourceQuote.trim() ||
		annotation.sourceQuote.trim() !== annotation.sourceQuote ||
		typeof annotation.sentenceQuote !== 'string' ||
		!annotation.sentenceQuote.trim() ||
		typeof annotation.explanationZhTw !== 'string' ||
		!annotation.explanationZhTw.trim() ||
		!/[\p{Script=Han}]/u.test(annotation.explanationZhTw) ||
		typeof annotation.generatedExample !== 'string' ||
		!annotation.generatedExample.trim() ||
		!categories.includes(annotation.category as (typeof categories)[number]) ||
		!(annotation.cefrLevel === null || cefrLevels.some((level) => level === annotation.cefrLevel))
	)
		throw new ImportError('Codex returned an annotation with missing or invalid fields.');
	const sourceQuote = annotation.sourceQuote;
	const sentenceSpans = allQuoteSpans(text, annotation.sentenceQuote);
	const matches = sentenceSpans.flatMap((sentenceSpan) => {
		const sentenceText = text.slice(sentenceSpan.start, sentenceSpan.end);
		return allQuoteSpans(sentenceText, sourceQuote).map((localSpan) => ({
			sentenceSpan,
			localSpan
		}));
	});
	if (!matches.length)
		throw new ImportError(
			`Codex returned an invalid or ambiguous source quote for annotation "${annotation.id}".`
		);
	return matches.map(({ sentenceSpan, localSpan }, index) => {
		const start = sentenceSpan.start + localSpan.start;
		return {
			id: matches.length === 1 ? annotation.id : `${annotation.id}-${index + 1}`,
			start,
			end: sentenceSpan.start + localSpan.end,
			sentenceStart: sentenceSpan.start,
			sentenceEnd: sentenceSpan.end,
			explanationZhTw: annotation.explanationZhTw,
			generatedExample: annotation.generatedExample,
			category: annotation.category,
			cefrLevel: annotation.cefrLevel
		} as ImportAnnotation;
	});
}

function validateBlockAnalysisResult(
	block: DraftSourceBlock,
	value: unknown,
	skipInvalidAnnotations = false
): { annotations: ImportAnnotation[]; errors: string[] } {
	if (
		!value ||
		typeof value !== 'object' ||
		!isDeepStrictEqual(Object.keys(value).sort(), resultKeys)
	)
		throw new ImportError('Codex returned malformed JSON output.');
	const output = value as Partial<BlockAnalysisOutput>;
	if (output.key !== block.key)
		throw new ImportError(`Codex returned an unexpected block result "${output.key ?? ''}".`);
	if (!Array.isArray(output.annotations))
		throw new ImportError('Codex output is missing annotations.');
	const local: ImportAnnotation[] = [];
	const errors: string[] = [];
	for (const annotation of output.annotations) {
		try {
			local.push(...validateLocalAnnotation(annotation, block.text));
		} catch (error) {
			if (!skipInvalidAnnotations) throw error;
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	const byPosition = [...local].sort((left, right) => left.start - right.start);
	const retained: ImportAnnotation[] = [];
	for (const annotation of byPosition) {
		if (retained.length && annotation.start < retained.at(-1)!.end) {
			if (!skipInvalidAnnotations)
				throw new ImportError('Codex returned overlapping annotation spans.');
			errors.push(`Codex returned overlapping annotation span "${annotation.id}".`);
			continue;
		}
		retained.push(annotation);
	}
	return {
		annotations: retained.map((annotation) => ({
			...annotation,
			id: `${block.key}-${annotation.id}`,
			start: annotation.start + block.globalStart,
			end: annotation.end + block.globalStart,
			sentenceStart: annotation.sentenceStart + block.globalStart,
			sentenceEnd: annotation.sentenceEnd + block.globalStart
		})),
		errors
	};
}

export function validateBlockAnalysis(block: DraftSourceBlock, value: unknown): ImportAnnotation[] {
	return validateBlockAnalysisResult(block, value).annotations;
}

export function validateBatchAnalysis(
	blocks: DraftSourceBlock[],
	value: unknown
): ImportAnnotation[] {
	const validated = validateAvailableBatchAnalysis(blocks, value);
	const missing = blocks.find((block) => !validated.completedKeys.has(block.key));
	if (missing) throw new ImportError(`Codex omitted block result "${missing.key}".`);
	return validated.annotations;
}

function validateAvailableBatchAnalysis(
	blocks: DraftSourceBlock[],
	value: unknown,
	skipInvalidAnnotations = false
): { annotations: ImportAnnotation[]; completedKeys: Set<string>; errors: string[] } {
	if (!value || typeof value !== 'object' || !isDeepStrictEqual(Object.keys(value), ['results']))
		throw new ImportError('Codex returned malformed JSON output.');
	const results = (value as { results?: unknown }).results;
	if (!Array.isArray(results)) throw new ImportError('Codex output is missing block results.');
	const requested = new Map(blocks.map((block) => [block.key, block]));
	const seen = new Set<string>();
	const annotations: ImportAnnotation[] = [];
	const errors: string[] = [];
	for (const result of results) {
		const key =
			result && typeof result === 'object' ? (result as { key?: unknown }).key : undefined;
		if (typeof key !== 'string' || !requested.has(key))
			throw new ImportError(`Codex returned an unexpected block result "${String(key ?? '')}".`);
		if (seen.has(key)) throw new ImportError(`Codex returned a duplicate block result "${key}".`);
		seen.add(key);
		const validated = validateBlockAnalysisResult(
			requested.get(key)!,
			result,
			skipInvalidAnnotations
		);
		annotations.push(...validated.annotations);
		errors.push(...validated.errors);
	}
	return {
		annotations: annotations.sort((left, right) => left.start - right.start),
		completedKeys: seen,
		errors
	};
}

function promptForBatch(
	draft: ImportDraft,
	blocks: DraftSourceBlock[],
	previousError?: string
): string {
	return [
		'Analyze each exact English source block independently for contextual Word Help.',
		'Do not call tools, inspect files, search, or run commands. Produce the final structured response directly from the supplied data.',
		'Identify CEFR A2+ terms, idioms, phrasal verbs, and contextually unusual meanings.',
		'Return exactly one keyed result per source block, with Traditional Chinese explanations and one generated English example per annotation.',
		'For each annotation, copy sourceQuote and its complete containing sentenceQuote exactly from sourceText. Never estimate or return character offsets.',
		'Each sentenceQuote must occur exactly once within its source block. A repeated sourceQuote is allowed when the same explanation applies to every occurrence in that sentence. Never span blocks.',
		'Do not return sourceText or reproduce whole source blocks. Copy only each key and the short quotes needed by annotations.',
		...(previousError
			? [
					`The previous response was rejected: ${previousError} Correct that problem in this response.`
				]
			: []),
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
	const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_ANALYSIS_REQUEST_TIMEOUT_MS;
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
	const diagnosticDirectory = options.diagnosticDirectory;
	let nextBatch = 0;
	let activeBatches = 0;
	let retryCount = 0;
	let failure: Error | undefined;
	let checkpointQueue = Promise.resolve();
	try {
		const serializedSchema = JSON.stringify(analysisSchema, null, 2);
		await writeFile(schemaPath, serializedSchema, 'utf8');
		if (diagnosticDirectory) {
			await mkdir(diagnosticDirectory, { recursive: true });
			await writeFile(join(diagnosticDirectory, 'analysis-schema.json'), serializedSchema, 'utf8');
		}
		const runBatch = async (batch: DraftSourceBlock[]) => {
			let pending = batch;
			let previousError: string | undefined;
			activeBatches += 1;
			options.onAnalysisEvent?.({ type: 'batch-start', activeBatches });
			try {
				for (let attempt = 0; attempt < 2; attempt += 1) {
					if (options.signal?.aborted) throw abortedError();
					const outputPath = join(directory, `${randomUUID()}.json`);
					try {
						const requested = pending;
						const requestPrompt = promptForBatch(draft, requested, previousError);
						const args = [
							'exec',
							'--json',
							'--ephemeral',
							'--ignore-user-config',
							'--ignore-rules',
							'--skip-git-repo-check',
							'--disable',
							'shell_tool',
							'--disable',
							'unified_exec',
							'--disable',
							'multi_agent',
							'--disable',
							'apps',
							'--disable',
							'hooks',
							'-c',
							'web_search="disabled"',
							'--sandbox',
							'read-only',
							'--output-schema',
							schemaPath,
							'-o',
							outputPath
						];
						if (options.model) args.push('--model', options.model);
						args.push('-');
						let requestDiagnostics:
							| { directory: string; eventsPath: string; stderrPath: string }
							| undefined;
						if (diagnosticDirectory) {
							const requestDirectory = join(
								diagnosticDirectory,
								`${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`
							);
							await mkdir(requestDirectory, { recursive: true });
							requestDiagnostics = {
								directory: requestDirectory,
								eventsPath: join(requestDirectory, 'events.jsonl'),
								stderrPath: join(requestDirectory, 'stderr.log')
							};
							await writeFile(requestDiagnostics.eventsPath, '', 'utf8');
							await writeFile(requestDiagnostics.stderrPath, '', 'utf8');
							await writeFile(join(requestDirectory, 'prompt.txt'), requestPrompt, 'utf8');
							await writeFile(
								join(requestDirectory, 'request.json'),
								`${JSON.stringify({ startedAt: new Date().toISOString(), attempt: attempt + 1, model: options.model ?? null, keys: requested.map((block) => block.key), command: options.codexCommand ?? process.env.CODEX_COMMAND ?? 'codex', args }, null, 2)}\n`,
								'utf8'
							);
						}
						await runCodex(
							options.codexCommand ?? process.env.CODEX_COMMAND ?? 'codex',
							args,
							requestPrompt,
							options.signal,
							directory,
							requestTimeoutMs,
							requestDiagnostics
						);
						let output: unknown;
						try {
							const rawOutput = await readFile(outputPath, 'utf8');
							if (requestDiagnostics) {
								await writeFile(
									join(requestDiagnostics.directory, 'final-response.json'),
									rawOutput,
									'utf8'
								);
							}
							output = JSON.parse(rawOutput);
						} catch {
							throw new ImportError('Codex returned malformed JSON output.');
						}
						const validated = validateAvailableBatchAnalysis(requested, output, attempt === 1);
						if (validated.errors.length)
							options.onAnalysisEvent?.({
								type: 'annotation-skipped',
								keys: requested.map((block) => block.key),
								activeBatches,
								errors: validated.errors
							});
						const returned = requested.filter((block) => validated.completedKeys.has(block.key));
						pending = requested.filter((block) => !validated.completedKeys.has(block.key));
						if (returned.length)
							checkpointQueue = checkpointQueue.then(async () => {
								annotations = [...annotations, ...validated.annotations].sort(
									(left, right) => left.start - right.start || left.id.localeCompare(right.id)
								);
								for (const block of returned) completed.add(block.key);
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
									keys: returned.map((block) => block.key),
									completedBlocks: completed.size,
									activeBatches: pending.length ? activeBatches : activeBatches - 1
								});
							});
						await checkpointQueue;
						if (!pending.length) return;
						throw new ImportError(
							`Codex omitted block result${pending.length === 1 ? '' : 's'} ${pending.map((block) => `"${block.key}"`).join(', ')}.`
						);
					} catch (error) {
						if (options.signal?.aborted) throw abortedError();
						if (attempt === 1) throw error;
						retryCount += 1;
						previousError = error instanceof Error ? error.message : String(error);
						options.onAnalysisEvent?.({
							type: 'batch-retry',
							keys: pending.map((block) => block.key),
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
