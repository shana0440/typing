import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { draftSourceText } from './draft.ts';
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
		source: {
			type: 'object',
			properties: {
				sections: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							heading: { type: ['string', 'null'] },
							blocks: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										type: {
											type: 'string',
											enum: ['paragraph', 'blockquote', 'preformatted', 'list-item']
										},
										text: { type: 'string' }
									},
									required: ['type', 'text'],
									additionalProperties: false
								}
							}
						},
						required: ['id', 'heading', 'blocks'],
						additionalProperties: false
					}
				}
			},
			required: ['sections'],
			additionalProperties: false
		},
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
				required: [
					'id',
					'start',
					'end',
					'sentenceStart',
					'sentenceEnd',
					'explanationZhTw',
					'generatedExample',
					'category',
					'cefrLevel'
				],
				additionalProperties: false
			}
		}
	},
	required: ['source', 'annotations'],
	additionalProperties: false
};

type AnalysisOutput = {
	source: ImportDraft['source'];
	annotations: unknown[];
};

function runCodex(command: string, args: string[], prompt: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => (stderr += chunk));
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

function validateAnnotation(value: unknown, text: string): ImportAnnotation {
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

export function validateAnalysis(draft: ImportDraft, value: unknown): ImportAnnotation[] {
	if (!value || typeof value !== 'object')
		throw new ImportError('Codex returned malformed JSON output.');
	const output = value as Partial<AnalysisOutput>;
	if (!isDeepStrictEqual(Object.keys(value).sort(), ['annotations', 'source'])) {
		throw new ImportError('Codex returned malformed JSON output.');
	}
	if (!isDeepStrictEqual(output.source, draft.source)) {
		throw new ImportError('Codex attempted to mutate or replace immutable source content.');
	}
	if (!Array.isArray(output.annotations))
		throw new ImportError('Codex output is missing annotations.');

	const text = draftSourceText(draft);
	const annotations = output.annotations.map((annotation) => validateAnnotation(annotation, text));
	const ids = new Set<string>();
	for (const annotation of [...annotations].sort((left, right) => left.start - right.start)) {
		if (ids.has(annotation.id))
			throw new ImportError(`Duplicate annotation id "${annotation.id}".`);
		ids.add(annotation.id);
	}
	const byPosition = [...annotations].sort((left, right) => left.start - right.start);
	for (let index = 1; index < byPosition.length; index += 1) {
		if (byPosition[index].start < byPosition[index - 1].end) {
			throw new ImportError('Codex returned overlapping annotation spans.');
		}
	}
	return byPosition;
}

export async function analyzeImportDraft(
	draft: ImportDraft,
	codexCommand = process.env.CODEX_COMMAND || 'codex'
): Promise<ImportAnnotation[]> {
	const directory = await mkdtemp(join(tmpdir(), 'typing-codex-'));
	const schemaPath = join(directory, 'analysis-schema.json');
	const outputPath = join(directory, 'analysis.json');
	try {
		await writeFile(schemaPath, JSON.stringify(analysisSchema), 'utf8');
		const prompt = [
			'Analyze this exact English Reading Source for contextual Word Help.',
			'Identify CEFR B2+ terms, idioms, phrasal verbs, and contextually unusual meanings.',
			'Return Traditional Chinese explanations and one generated English example for each annotation.',
			'Offsets use JavaScript UTF-16 string indices in the canonical source text formed by joining blocks and sections with two newline characters.',
			'Copy the source object byte-for-byte in meaning and structure. Never rewrite, correct, summarize, or mutate it.',
			JSON.stringify({ source: draft.source })
		].join('\n\n');
		await runCodex(
			codexCommand,
			[
				'exec',
				'--ephemeral',
				'--sandbox',
				'read-only',
				'--output-schema',
				schemaPath,
				'-o',
				outputPath,
				'-'
			],
			prompt
		);

		let output: unknown;
		try {
			output = JSON.parse(await readFile(outputPath, 'utf8'));
		} catch {
			throw new ImportError('Codex returned malformed JSON output.');
		}
		return validateAnalysis(draft, output);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
