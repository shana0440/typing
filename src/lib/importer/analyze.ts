import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { draftSourceBlocks, type DraftSourceBlock } from './draft.ts';
import { ImportError } from './extract.ts';
import type { ImportAnnotation, ImportDraft } from './types.ts';

const categories = ['term', 'idiom', 'phrasal-verb', 'contextual-meaning'] as const;
const cefrLevels = ['B2', 'C1', 'C2'] as const;
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

const analysisSchema = {
	type: 'object',
	properties: {
		sourceText: { type: 'string' },
		annotations: {
			type: 'array',
			items: {
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
			}
		}
	},
	required: ['sourceText', 'annotations'],
	additionalProperties: false
};

type BlockAnalysisOutput = { sourceText: string; annotations: unknown[] };
export type AnalysisCheckpoint = NonNullable<ImportDraft['analysisProgress']> & {
	annotations: ImportAnnotation[];
};
export type AnalysisOptions = {
	codexCommand?: string;
	model?: string;
	onEvent?: (eventType: string) => void;
	onBlockStart?: (index: number, total: number) => void;
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

function runCodex(
	command: string,
	args: string[],
	prompt: string,
	onProgress?: (eventType: string) => void
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
		let stderr = '';
		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
			const lines = stdout.split('\n');
			stdout = lines.pop() ?? '';
			for (const line of lines) {
				try {
					const event = JSON.parse(line) as { type?: unknown };
					if (typeof event.type === 'string') onProgress?.(event.type);
				} catch {
					// Progress events are advisory; final schema validation remains authoritative.
				}
			}
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => (stderr += chunk));
		child.stdin.on('error', () => {
			// The process error/exit handler below reports the actionable failure.
		});
		child.on('error', (error) =>
			reject(new ImportError(`Could not start Codex CLI: ${error.message}`))
		);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else
				reject(
					new ImportError(`Codex analysis failed${stderr.trim() ? `: ${stderr.trim()}` : '.'}`)
				);
		});
		child.stdin.end(prompt);
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
	) {
		throw new ImportError('Codex returned an annotation with missing or invalid fields.');
	}
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
	) {
		throw new ImportError(
			`Codex returned an invalid source span for annotation "${annotation.id}".`
		);
	}
	return annotation as ImportAnnotation;
}

export function validateBlockAnalysis(block: DraftSourceBlock, value: unknown): ImportAnnotation[] {
	if (!value || typeof value !== 'object')
		throw new ImportError('Codex returned malformed JSON output.');
	if (!isDeepStrictEqual(Object.keys(value).sort(), ['annotations', 'sourceText'])) {
		throw new ImportError('Codex returned malformed JSON output.');
	}
	const output = value as Partial<BlockAnalysisOutput>;
	if (output.sourceText !== block.text) {
		throw new ImportError('Codex attempted to mutate or replace immutable source content.');
	}
	if (!Array.isArray(output.annotations))
		throw new ImportError('Codex output is missing annotations.');

	const local = output.annotations.map((annotation) =>
		validateLocalAnnotation(annotation, block.text)
	);
	const byPosition = [...local].sort((left, right) => left.start - right.start);
	for (let index = 1; index < byPosition.length; index += 1) {
		if (byPosition[index].start < byPosition[index - 1].end) {
			throw new ImportError('Codex returned overlapping annotation spans.');
		}
	}
	return byPosition.map((annotation) => ({
		...annotation,
		id: `${block.key}-${annotation.id}`,
		start: annotation.start + block.globalStart,
		end: annotation.end + block.globalStart,
		sentenceStart: annotation.sentenceStart + block.globalStart,
		sentenceEnd: annotation.sentenceEnd + block.globalStart
	}));
}

export async function analyzeImportDraft(
	draft: ImportDraft,
	options: AnalysisOptions = {}
): Promise<AnalysisCheckpoint> {
	const blocks = draftSourceBlocks(draft);
	const digest = sourceDigest(draft);
	const resumable = draft.analysisProgress?.sourceDigest === digest;
	const blockKeys = new Set(blocks.map((block) => block.key));
	const completedBlocks = resumable
		? [...new Set(draft.analysisProgress!.completedBlocks.filter((key) => blockKeys.has(key)))]
		: [];
	let annotations = resumable ? [...draft.annotations] : [];
	const completed = new Set(completedBlocks);
	const directory = await mkdtemp(join(tmpdir(), 'typing-codex-'));
	const schemaPath = join(directory, 'analysis-schema.json');
	const outputPath = join(directory, 'analysis.json');
	try {
		await writeFile(schemaPath, JSON.stringify(analysisSchema), 'utf8');
		for (const [index, block] of blocks.entries()) {
			if (completed.has(block.key)) continue;
			options.onBlockStart?.(index, blocks.length);
			const prompt = [
				'Analyze this exact English paragraph for contextual Word Help.',
				'Identify CEFR B2+ terms, idioms, phrasal verbs, and contextually unusual meanings.',
				'Return Traditional Chinese explanations and one generated English example for each annotation.',
				'All offsets are JavaScript UTF-16 indices local to sourceText.',
				'Copy sourceText exactly. Never rewrite, correct, summarize, or mutate it.',
				JSON.stringify({
					title: draft.metadata.title,
					sectionHeading: block.sectionHeading,
					sourceText: block.text
				})
			].join('\n\n');
			await rm(outputPath, { force: true });
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
				prompt,
				options.onEvent
			);

			let output: unknown;
			try {
				output = JSON.parse(await readFile(outputPath, 'utf8'));
			} catch {
				throw new ImportError('Codex returned malformed JSON output.');
			}
			annotations = [...annotations, ...validateBlockAnalysis(block, output)].sort(
				(left, right) => left.start - right.start
			);
			completed.add(block.key);
			const checkpoint: AnalysisCheckpoint = {
				sourceDigest: digest,
				completedBlocks: [...completed],
				lastModel: options.model ?? null,
				annotations
			};
			await options.onCheckpoint?.(checkpoint);
		}
		return {
			sourceDigest: digest,
			completedBlocks: [...completed],
			lastModel: options.model ?? draft.analysisProgress?.lastModel ?? null,
			annotations
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
