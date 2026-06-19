import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

function newDraft(): ImportDraft {
	return {
		schemaVersion: 1,
		status: 'draft',
		id: 'a-careful-test-123456789abc',
		metadata: {
			title: 'A Careful Test',
			author: 'Ada Example',
			language: 'en',
			originalUrl: 'https://example.com/careful-test'
		},
		source,
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
import { writeFileSync } from 'node:fs';
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => prompt += chunk);
process.stdin.on('end', () => {
  if (process.env.FAKE_CODEX_LOG) writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args: process.argv.slice(2), prompt }));
  if (process.env.FAKE_CODEX_FAIL === '1') { console.error('simulated Codex failure'); process.exit(2); }
  const args = process.argv.slice(2);
  const outputPath = args[args.indexOf('-o') + 1];
  writeFileSync(outputPath, process.env.FAKE_CODEX_RESPONSE ?? '');
});
`,
			'utf8'
		);
		await chmod(fakeCodex, 0o755);
	});

	afterAll(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	async function runWorkflow(options: {
		input?: string;
		response?: string;
		fail?: boolean;
		name: string;
	}) {
		const testDirectory = join(directory, options.name);
		const draftPath = join(testDirectory, 'draft.json');
		const catalogPath = join(testDirectory, 'catalog.json');
		const logPath = join(testDirectory, 'codex-log.json');
		await writeFile(draftPath, `${JSON.stringify(newDraft(), null, 2)}\n`, { flag: 'w' }).catch(
			async (error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
				const { mkdir } = await import('node:fs/promises');
				await mkdir(testDirectory, { recursive: true });
				await writeFile(draftPath, `${JSON.stringify(newDraft(), null, 2)}\n`);
			}
		);
		await writeFile(catalogPath, '[]\n');

		return new Promise<{
			code: number | null;
			stdout: string;
			stderr: string;
			draftPath: string;
			catalogPath: string;
			logPath: string;
		}>((done) => {
			const answers = (options.input ?? '')
				.split('\n')
				.map((answer) => answer.trim())
				.filter(Boolean);
			let answersSent = 0;
			const child = spawn(
				'bun',
				['run', 'publish:draft', draftPath, '--catalog-file', catalogPath],
				{
					cwd: projectRoot,
					env: {
						...process.env,
						CODEX_COMMAND: fakeCodex,
						FAKE_CODEX_RESPONSE: options.response ?? '',
						FAKE_CODEX_FAIL: options.fail ? '1' : '0',
						FAKE_CODEX_LOG: logPath,
						IMPORT_PREVIEW_NO_OPEN: '1'
					},
					stdio: ['pipe', 'pipe', 'pipe']
				}
			);
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				stdout += chunk;
				const prompts = stdout.match(/Type "yes" to confirm:/g)?.length ?? 0;
				while (answersSent < prompts && answersSent < answers.length) {
					child.stdin.write(`${answers[answersSent]}\n`);
					answersSent += 1;
					if (answersSent === answers.length) child.stdin.end();
				}
			});
			child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
			child.on('close', (code) => done({ code, stdout, stderr, draftPath, catalogPath, logPath }));
			if (answers.length === 0) child.stdin.end();
		});
	}

	it('publishes deterministic static Catalog data after both confirmations', async () => {
		const response = JSON.stringify({ source, annotations: [validAnnotation] });
		const result = await runWorkflow({ name: 'approved', input: 'yes\nyes\n', response });

		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Review the complete Import Draft at http://127.0.0.1:');
		expect(result.stdout).toContain('Files were written only');
		const catalogArtifact = await readFile(result.catalogPath, 'utf8');
		const catalog = JSON.parse(catalogArtifact);
		expect(catalog).toHaveLength(1);
		expect(catalog[0]).toMatchObject({
			id: 'a-careful-test-123456789abc',
			title: 'A Careful Test',
			originalUrl: 'https://example.com/careful-test',
			wordHelp: [validAnnotation]
		});
		expect(catalog[0].sections[0].text).toBe(sourceText);
		const retainedDraft = JSON.parse(await readFile(result.draftPath, 'utf8')) as ImportDraft;
		expect(retainedDraft).toMatchObject({
			status: 'analyzed',
			redistributionConfirmed: true,
			annotations: [validAnnotation]
		});

		const codexLog = JSON.parse(await readFile(result.logPath, 'utf8'));
		expect(codexLog.args).toEqual(
			expect.arrayContaining([
				'exec',
				'--ephemeral',
				'--sandbox',
				'read-only',
				'--output-schema',
				'-o'
			])
		);
		expect(codexLog.prompt).toContain(JSON.stringify({ source }));

		const second = await runWorkflow({ name: 'approved-again', input: 'yes\nyes\n', response });
		expect(await readFile(second.catalogPath, 'utf8')).toBe(catalogArtifact);
	});

	it('retains analyzed annotations and leaves Catalog unchanged after rejection', async () => {
		const result = await runWorkflow({
			name: 'rejected',
			input: 'no\n',
			response: JSON.stringify({ source, annotations: [validAnnotation] })
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('Publish rejected');
		expect(await readFile(result.catalogPath, 'utf8')).toBe('[]\n');
		expect(JSON.parse(await readFile(result.draftPath, 'utf8'))).toMatchObject({
			status: 'analyzed',
			redistributionConfirmed: false,
			annotations: [validAnnotation]
		});
	});

	it('blocks Publish when redistribution authorization is declined', async () => {
		const result = await runWorkflow({
			name: 'unauthorized',
			input: 'yes\nno\n',
			response: JSON.stringify({ source, annotations: [validAnnotation] })
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

	it('fails closed when the Codex subprocess fails', async () => {
		const result = await runWorkflow({ name: 'subprocess-failure', fail: true });
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Codex analysis failed: simulated Codex failure');
		expect(await readFile(result.catalogPath, 'utf8')).toBe('[]\n');
		expect(JSON.parse(await readFile(result.draftPath, 'utf8')).status).toBe('draft');
	});

	it.each([
		['malformed', '{not json', 'malformed JSON'],
		[
			'missing-fields',
			JSON.stringify({ source, annotations: [{ id: 'missing' }] }),
			'missing or invalid fields'
		],
		[
			'invalid-span',
			JSON.stringify({
				source,
				annotations: [{ ...validAnnotation, end: sourceText.length + 1 }]
			}),
			'invalid source span'
		],
		[
			'overlapping-spans',
			JSON.stringify({
				source,
				annotations: [validAnnotation, { ...validAnnotation, id: 'overlap', start: 8, end: 15 }]
			}),
			'overlapping annotation spans'
		],
		[
			'source-mutation',
			JSON.stringify({
				source: {
					sections: [
						{
							...source.sections[0],
							blocks: [{ type: 'paragraph', text: 'Rewritten source content.' }]
						}
					]
				},
				annotations: []
			}),
			'mutate or replace immutable source content'
		]
	])('rejects invalid Codex output: %s', async (name, response, message) => {
		const result = await runWorkflow({ name, response });
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(message);
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
