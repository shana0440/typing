import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPreview } from './preview.ts';
import type { ImportDraft } from './types.ts';

const projectRoot = resolve(import.meta.dirname, '../../..');
const sourceText =
	'The intricate mechanism remained quiet until dawn. Everyone waited patiently for the final signal.';
const source = {
	sections: [
		{
			id: 'section-1',
			heading: 'A careful test',
			blocks: [{ type: 'paragraph' as const, text: sourceText }]
		}
	]
};
const validAnnotation = {
	id: 'intricate',
	start: 4,
	end: 13,
	sentenceStart: 0,
	sentenceEnd: 49,
	explanationZhTw: '在此表示結構複雜、包含許多相互連動的細節。',
	generatedExample: 'The watchmaker studied the intricate pattern of gears.',
	category: 'term' as const,
	cefrLevel: 'B2' as const
};
const validAnalysisAnnotation = {
	id: validAnnotation.id,
	sourceQuote: sourceText.slice(validAnnotation.start, validAnnotation.end),
	sentenceQuote: sourceText.slice(validAnnotation.sentenceStart, validAnnotation.sentenceEnd),
	explanationZhTw: validAnnotation.explanationZhTw,
	generatedExample: validAnnotation.generatedExample,
	category: validAnnotation.category,
	cefrLevel: validAnnotation.cefrLevel
};
const publishedAnnotation = { ...validAnnotation, id: 'section-1:0-intricate' };

function newDraft(): ImportDraft {
	return {
		schemaVersion: 2,
		status: 'verified',
		id: 'a-careful-test-123456789abc',
		metadata: {
			title: 'A Careful Test',
			author: 'Ada Example',
			language: 'en',
			originalUrl: 'https://example.com/careful-test',
			requestedUrl: 'https://example.com/careful-test',
			finalUrl: 'https://example.com/careful-test',
			canonicalUrl: null,
			titleSuggestions: [],
			authorSuggestions: []
		},
		candidates: [],
		selectedCandidateId: null,
		blocked: null,
		diagnostics: {
			fetchedAt: '',
			httpStatus: 200,
			contentType: 'text/html',
			redirected: false,
			messages: []
		},
		source: structuredClone(source),
		annotations: [],
		redistributionConfirmed: false
	};
}

describe('Analyze and Publish workflow', () => {
	let directory: string;
	let fakeCodex: string;

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), 'typing-publish-'));
		fakeCodex = join(directory, 'codex');
		await writeFile(
			fakeCodex,
			`#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
if (process.argv[2] === 'app-server') {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const message = JSON.parse(line);
      if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: { userAgent: 'fake' } }));
      if (message.method === 'model/list') console.log(JSON.stringify({ id: message.id, result: { data: [
        { model: 'quality-model', displayName: 'Quality Model', description: 'Higher quality analysis.', isDefault: true, hidden: false },
        { model: 'economical-model', displayName: 'Economical Model', description: 'Lower token cost.', isDefault: false, hidden: false }
      ], nextCursor: null } }));
    }
  });
} else {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => prompt += chunk);
  process.stdin.on('end', () => {
    if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args: process.argv.slice(2), prompt, cwd: process.cwd() }) + '\\n');
	if (process.env.FAKE_CODEX_TOOL_ERROR === '1') {
	  console.error('ERROR codex_core::tools::router: error=failed to parse function arguments: EOF while parsing a string at line 1 column 447');
	  setInterval(() => {}, 1000);
	  return;
	}
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
    console.log(JSON.stringify({ type: 'turn.started' }));
    console.log(JSON.stringify({ type: 'item.started', item: { type: 'agent_message' } }));
	if (process.env.FAKE_CODEX_EVENT_ERROR === '1') {
	  console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'Incomplete response returned, reason: content_filter' } }));
	  process.exit(2);
	}
    console.log(JSON.stringify({ type: 'turn.completed' }));
    if (process.env.FAKE_CODEX_FAIL === '1' || (process.env.FAKE_CODEX_FAIL_ON_TEXT && prompt.includes(process.env.FAKE_CODEX_FAIL_ON_TEXT))) { console.error('simulated Codex failure'); process.exit(2); }
    const args = process.argv.slice(2);
    const outputPath = args[args.indexOf('-o') + 1];
    const input = JSON.parse(prompt.trim().split('\\n\\n').at(-1));
    let response;
    if (process.env.FAKE_CODEX_DYNAMIC === '1') {
      const blocks = process.env.FAKE_CODEX_OMIT_FIRST === '1' && input.blocks.length > 1 ? input.blocks.slice(1) : input.blocks;
      response = JSON.stringify({ results: blocks.map((block) => ({ key: block.key, annotations: [] })) });
    } else {
      try {
        const configured = JSON.parse(process.env.FAKE_CODEX_RESPONSE ?? '{}');
        response = JSON.stringify(configured.results ? configured : { results: [{ key: input.blocks[0].key, ...configured }] });
      } catch {
        response = process.env.FAKE_CODEX_RESPONSE ?? '';
      }
    }
    writeFileSync(outputPath, response);
  });
}
`,
			'utf8'
		);
		await chmod(fakeCodex, 0o755);
	});

	afterAll(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	async function runWorkflow(options: {
		draft?: ImportDraft;
		input?: string;
		model?: string | null;
		modelAnswer?: string;
		preserveDraft?: boolean;
		response?: string;
		fail?: boolean;
		failOnText?: string;
		dynamic?: boolean;
		omitFirst?: boolean;
		toolError?: boolean;
		eventError?: boolean;
		concurrency?: number;
		batchSize?: number;
		name: string;
	}) {
		const testDirectory = join(directory, options.name);
		const draftPath = join(testDirectory, 'draft.json');
		const catalogPath = join(testDirectory, 'catalog.json');
		const logPath = join(testDirectory, 'codex-log.json');
		await mkdir(testDirectory, { recursive: true });
		if (!options.preserveDraft) {
			await writeFile(draftPath, `${JSON.stringify(options.draft ?? newDraft(), null, 2)}\n`);
			await writeFile(catalogPath, '[]\n');
			await rm(logPath, { force: true });
		}

		return new Promise<{
			code: number | null;
			stdout: string;
			stderr: string;
			draftPath: string;
			catalogPath: string;
			logPath: string;
		}>((done) => {
			const model = options.model === undefined ? 'test-model' : options.model;
			const answers = (options.input ?? '')
				.split('\n')
				.map((answer) => answer.trim())
				.filter(Boolean);
			let answersSent = 0;
			let modelSent = model !== null;
			const command = ['run', 'publish:draft', draftPath];
			if (model) command.push('--model', model);
			command.push('--catalog-file', catalogPath);
			if (options.concurrency) command.push('--concurrency', String(options.concurrency));
			if (options.batchSize) command.push('--batch-size', String(options.batchSize));
			const child = spawn('bun', command, {
				cwd: projectRoot,
				env: {
					...process.env,
					CODEX_COMMAND: fakeCodex,
					FAKE_CODEX_RESPONSE: options.response ?? '',
					FAKE_CODEX_FAIL: options.fail ? '1' : '0',
					FAKE_CODEX_FAIL_ON_TEXT: options.failOnText ?? '',
					FAKE_CODEX_DYNAMIC: options.dynamic ? '1' : '0',
					FAKE_CODEX_OMIT_FIRST: options.omitFirst ? '1' : '0',
					FAKE_CODEX_TOOL_ERROR: options.toolError ? '1' : '0',
					FAKE_CODEX_EVENT_ERROR: options.eventError ? '1' : '0',
					FAKE_CODEX_LOG: logPath,
					IMPORT_PREVIEW_NO_OPEN: '1'
				},
				stdio: ['pipe', 'pipe', 'pipe']
			});
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				stdout += chunk;
				if (!modelSent && stdout.includes('Select a model')) {
					child.stdin.write(`${options.modelAnswer ?? ''}\n`);
					modelSent = true;
				}
				const prompts = stdout.match(/Type "yes" to confirm:/g)?.length ?? 0;
				while (answersSent < prompts && answersSent < answers.length) {
					child.stdin.write(`${answers[answersSent]}\n`);
					answersSent += 1;
					if (answersSent === answers.length && modelSent) child.stdin.end();
				}
			});
			child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
			child.on('close', (code) => done({ code, stdout, stderr, draftPath, catalogPath, logPath }));
			if (answers.length === 0 && modelSent) child.stdin.end();
		});
	}

	it('publishes deterministic static Catalog data after authorization', async () => {
		const response = JSON.stringify({ annotations: [validAnalysisAnnotation] });
		const result = await runWorkflow({ name: 'approved', input: 'yes\n', response });

		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Batch complete: section-1:0');
		expect(result.stdout).toContain('Analysis complete');
		expect(result.stdout).not.toContain('Is the extracted source and every annotation accurate?');
		expect(result.stdout).not.toContain('Review the complete Import Draft');
		expect(result.stdout).toContain('Are you authorized to redistribute');
		expect(result.stdout).toContain('Files were written only');
		const catalogArtifact = await readFile(result.catalogPath, 'utf8');
		const catalog = JSON.parse(catalogArtifact);
		expect(catalog).toHaveLength(1);
		expect(catalog[0]).toMatchObject({
			id: 'a-careful-test-123456789abc',
			title: 'A Careful Test',
			originalUrl: 'https://example.com/careful-test'
		});
		const packageDirectory = join(directory, 'approved', 'sources', 'a-careful-test-123456789abc');
		expect(
			JSON.parse(await readFile(join(packageDirectory, 'manifest.json'), 'utf8'))
		).toMatchObject({
			sections: [{ id: 'section-1', title: 'A careful test' }]
		});
		expect(
			JSON.parse(
				await readFile(join(packageDirectory, 'sections', 'section-1', 'content.json'), 'utf8')
			)
		).toMatchObject({ text: sourceText });
		expect(
			JSON.parse(
				await readFile(join(packageDirectory, 'sections', 'section-1', 'word-help.json'), 'utf8')
			)
		).toEqual([publishedAnnotation]);
		const retainedDraft = JSON.parse(await readFile(result.draftPath, 'utf8')) as ImportDraft;
		expect(retainedDraft).toMatchObject({
			status: 'analyzed',
			redistributionConfirmed: true,
			annotations: [publishedAnnotation]
		});

		const codexLog = JSON.parse((await readFile(result.logPath, 'utf8')).trim());
		expect(codexLog.args).toEqual(
			expect.arrayContaining([
				'exec',
				'--ephemeral',
				'--ignore-user-config',
				'--ignore-rules',
				'--skip-git-repo-check',
				'shell_tool',
				'unified_exec',
				'multi_agent',
				'apps',
				'hooks',
				'web_search="disabled"',
				'--sandbox',
				'read-only',
				'--output-schema',
				'-o'
			])
		);
		expect(codexLog.args).toEqual(expect.arrayContaining(['--model', 'test-model']));
		expect(codexLog.cwd).toContain('typing-codex-');
		expect(codexLog.cwd).not.toBe(projectRoot);
		expect(codexLog.prompt).toContain('Do not call tools, inspect files, search, or run commands.');
		expect(codexLog.prompt).toContain(
			JSON.stringify({
				title: 'A Careful Test',
				blocks: [
					{
						key: 'section-1:0',
						sectionHeading: 'A careful test',
						sourceText
					}
				]
			})
		);
		const diagnosticDirectory = join(directory, 'approved', 'draft.artifacts', 'codex');
		expect(
			JSON.parse(await readFile(join(diagnosticDirectory, 'analysis-schema.json'), 'utf8'))
		).toMatchObject({ type: 'object' });
		const requestDirectories = (await readdir(diagnosticDirectory)).filter(
			(name) => name !== 'analysis-schema.json'
		);
		expect(requestDirectories).toHaveLength(1);
		const requestDirectory = join(diagnosticDirectory, requestDirectories[0]);
		expect(await readFile(join(requestDirectory, 'events.jsonl'), 'utf8')).toContain(
			'"type":"turn.completed"'
		);
		expect(await readFile(join(requestDirectory, 'stderr.log'), 'utf8')).toBe('');
		expect(await readFile(join(requestDirectory, 'prompt.txt'), 'utf8')).toContain(sourceText);
		expect(
			JSON.parse(await readFile(join(requestDirectory, 'request.json'), 'utf8'))
		).toMatchObject({
			attempt: 1,
			model: 'test-model',
			keys: ['section-1:0']
		});
		expect(
			JSON.parse(await readFile(join(requestDirectory, 'final-response.json'), 'utf8'))
		).toMatchObject({ results: [{ key: 'section-1:0' }] });

		const second = await runWorkflow({ name: 'approved-again', input: 'yes\n', response });
		expect(await readFile(second.catalogPath, 'utf8')).toBe(catalogArtifact);
	});

	it('blocks Publish when redistribution authorization is declined', async () => {
		const result = await runWorkflow({
			name: 'unauthorized',
			input: 'no\n',
			response: JSON.stringify({ annotations: [validAnalysisAnnotation] })
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Are you authorized to redistribute');
		expect(result.stdout).toContain('Publish rejected');
		expect(await readFile(result.catalogPath, 'utf8')).toBe('[]\n');
		expect(JSON.parse(await readFile(result.draftPath, 'utf8'))).toMatchObject({
			status: 'analyzed',
			redistributionConfirmed: false
		});
	});

	it('prompts for and applies a model before analysis', async () => {
		const result = await runWorkflow({
			name: 'selected-model',
			model: null,
			modelAnswer: '2',
			input: 'no\n',
			response: JSON.stringify({ annotations: [] })
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Available Codex models:');
		expect(result.stdout).toContain('1. Quality Model (quality-model) [Codex default]');
		expect(result.stdout).toContain('2. Economical Model (economical-model)');
		expect(result.stdout).toContain('Select a model [1]');
		expect(result.stdout).toContain('Using Codex model: economical-model');
		const log = JSON.parse((await readFile(result.logPath, 'utf8')).trim());
		expect(log.args).toEqual(expect.arrayContaining(['--model', 'economical-model']));
	});

	it('fails closed when the Codex subprocess fails', async () => {
		const result = await runWorkflow({ name: 'subprocess-failure', fail: true });
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Codex analysis failed: simulated Codex failure');
		expect(await readFile(result.catalogPath, 'utf8')).toBe('[]\n');
		expect(JSON.parse(await readFile(result.draftPath, 'utf8')).status).toBe('verified');
	});

	it('reports structured Codex event errors when stderr is empty', async () => {
		const result = await runWorkflow({ name: 'event-error', eventError: true });
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			'Codex analysis failed: Incomplete response returned, reason: content_filter'
		);
	});

	it('fails fast when Codex emits malformed tool-call arguments', async () => {
		const startedAt = Date.now();
		const result = await runWorkflow({ name: 'malformed-tool-call', toolError: true });

		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			'Codex emitted malformed tool-call arguments during output-only analysis'
		);
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});

	it('checkpoints each batch and resumes after a subprocess failure', async () => {
		const secondText =
			'A second paragraph should be analyzed only after the saved first checkpoint.';
		const draft = newDraft();
		draft.source.sections[0].blocks.push({ type: 'paragraph', text: secondText });
		const interrupted = await runWorkflow({
			name: 'resumable',
			draft,
			dynamic: true,
			failOnText: secondText,
			batchSize: 1,
			concurrency: 1
		});
		expect(interrupted.code).toBe(1);
		expect(interrupted.stdout).toContain('Batch complete: section-1:0');
		expect(interrupted.stdout).toContain('Analysis paused; checkpoints retained');
		const checkpoint = JSON.parse(await readFile(interrupted.draftPath, 'utf8')) as ImportDraft;
		expect(checkpoint).toMatchObject({
			status: 'verified',
			analysisProgress: {
				completedBlocks: ['section-1:0'],
				lastModel: 'test-model'
			}
		});

		const resumed = await runWorkflow({
			name: 'resumable',
			preserveDraft: true,
			dynamic: true,
			input: 'no\n',
			batchSize: 1,
			concurrency: 1
		});
		expect(resumed.code).toBe(0);
		expect(resumed.stdout).toContain('Batch complete: section-1:1');
		expect(resumed.stdout).toContain('Analysis complete');
		const completed = JSON.parse(await readFile(resumed.draftPath, 'utf8')) as ImportDraft;
		expect(completed.analysisProgress?.completedBlocks).toEqual(['section-1:0', 'section-1:1']);

		const logs = (await readFile(resumed.logPath, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { prompt: string });
		expect(logs.filter((entry) => entry.prompt.includes(sourceText))).toHaveLength(1);
		expect(logs.filter((entry) => entry.prompt.includes(secondText))).toHaveLength(3);
	});

	it('analyzes one source block per Codex request by default', async () => {
		const draft = newDraft();
		for (let index = 1; index < 3; index += 1) {
			draft.source.sections[0].blocks.push({
				type: 'paragraph',
				text: `Distinct source block ${index} contains enough text for independent analysis.`
			});
		}
		const result = await runWorkflow({
			name: 'default-batching',
			draft,
			dynamic: true,
			input: 'no\n'
		});

		expect(result.code).toBe(0);
		const requests = (await readFile(result.logPath, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { prompt: string })
			.map(
				(entry) => JSON.parse(entry.prompt.trim().split('\n\n').at(-1)!) as { blocks: unknown[] }
			);
		expect(requests.map((request) => request.blocks.length)).toEqual([1, 1, 1]);
	});

	it('checkpoints valid results and retries only an omitted block', async () => {
		const draft = newDraft();
		draft.source.sections[0].blocks.push(
			{ type: 'paragraph', text: 'Second block for partial batch recovery.' },
			{ type: 'paragraph', text: 'Third block for partial batch recovery.' }
		);
		const result = await runWorkflow({
			name: 'partial-batch-recovery',
			draft,
			dynamic: true,
			omitFirst: true,
			input: 'no\n',
			concurrency: 1,
			batchSize: 3
		});

		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Retrying batch section-1:0');
		const completed = JSON.parse(await readFile(result.draftPath, 'utf8')) as ImportDraft;
		expect(completed.analysisProgress?.completedBlocks).toEqual([
			'section-1:0',
			'section-1:1',
			'section-1:2'
		]);
		const requests = (await readFile(result.logPath, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { prompt: string })
			.map(
				(entry) =>
					JSON.parse(entry.prompt.trim().split('\n\n').at(-1)!) as {
						blocks: Array<{ key: string }>;
					}
			);
		expect(requests.map((request) => request.blocks.map((block) => block.key))).toEqual([
			['section-1:0', 'section-1:1', 'section-1:2'],
			['section-1:0']
		]);
	});

	it.each([
		['--concurrency', '0', 'Concurrency must be an integer from 1 through 16'],
		['--concurrency', '17', 'Concurrency must be an integer from 1 through 16'],
		['--batch-size', '0', 'Batch size must be an integer from 1 through 50'],
		['--batch-size', '51', 'Batch size must be an integer from 1 through 50']
	])(
		'rejects invalid %s values before reading the Import Draft',
		async (option, value, message) => {
			const result = await new Promise<{ code: number | null; stderr: string }>((done) => {
				const child = spawn(
					'bun',
					['run', 'publish:draft', join(directory, 'missing-draft.json'), option, value],
					{ cwd: projectRoot, stdio: ['ignore', 'ignore', 'pipe'] }
				);
				let stderr = '';
				child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
				child.on('close', (code) => done({ code, stderr }));
			});
			expect(result.code).toBe(1);
			expect(result.stderr).toContain(message);
			expect(result.stderr).not.toContain('Could not read Import Draft');
		}
	);

	it.each([
		['malformed', '{not json', 'malformed JSON'],
		[
			'unexpected-source-echo',
			JSON.stringify({
				sourceText,
				annotations: []
			}),
			'malformed JSON output'
		]
	])('rejects invalid Codex output: %s', async (name, response, message) => {
		const result = await runWorkflow({ name, response });
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(message);
		expect(await readFile(result.catalogPath, 'utf8')).toBe('[]\n');
	});

	it.each([
		[
			'missing-fields',
			JSON.stringify({ annotations: [{ id: 'missing' }] }),
			'missing or invalid fields'
		],
		[
			'invalid-quote',
			JSON.stringify({
				annotations: [{ ...validAnalysisAnnotation, sourceQuote: 'not in the source' }]
			}),
			'invalid or ambiguous source quote'
		],
		[
			'overlapping-spans',
			JSON.stringify({
				annotations: [
					validAnalysisAnnotation,
					{ ...validAnalysisAnnotation, id: 'overlap', sourceQuote: 'intricate mechanism' }
				]
			}),
			'overlapping annotation span'
		]
	])('skips an invalid annotation after retry: %s', async (name, response, message) => {
		const result = await runWorkflow({ name: `salvage-${name}`, response, input: 'no\n' });
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(`Retrying batch section-1:0: Codex returned`);
		expect(result.stdout).toContain('Skipped invalid annotation in section-1:0');
		expect(result.stdout).toContain(message);
		expect(result.stdout).toContain('Batch complete: section-1:0');
		expect(await readFile(result.catalogPath, 'utf8')).toBe('[]\n');
	});

	it('renders complete source metadata and every annotation in the preview', () => {
		const draft = newDraft();
		draft.status = 'analyzed';
		draft.annotations = [validAnnotation];
		const preview = renderPreview(draft);
		expect(preview).toContain('A Careful Test');
		expect(preview).toContain('Ada Example');
		expect(preview).toContain('https://example.com/careful-test');
		expect(preview).toContain(sourceText);
		expect(preview).toContain('<mark>intricate</mark>');
		expect(preview).toContain(validAnnotation.explanationZhTw);
		expect(preview).toContain('Generated example');
	});
});
