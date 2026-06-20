import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportDraft } from './types';

const execute = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '../../..');
const articleHtml = `<!doctype html>
<html lang="en">
	<head>
		<title>A Patient Morning</title>
		<meta name="author" content="Ada Example">
	</head>
	<body>
		<nav>Ignore this navigation.</nav>
		<article>
			<h1>A Patient Morning</h1>
			<p>The first bell rang softly, and everyone in the old house paused to listen.</p>
			<h2>At the window</h2>
			<p>Mina opened the blue curtain. A <em>patient</em> light moved across the wooden floor.</p>
			<p>“Wait—don’t…” Mina’s ﬁrst ﬂame ‛flickered‟ across a non‑breaking path–then„settled. ‘Plain’ word‐word. A&nbsp;wide and narrow&#8239;space, plus soft&shy;hyphen. Keep café, ‚low quotes‚, and € unchanged.</p>
			<a href="/page-two">Next page</a>
		</article>
		<footer>Ignore this footer.</footer>
	</body>
</html>`;
const legacyBookHtml = `<!doctype html>
<html>
	<head><title>A Legacy Book</title></head>
	<body>
		<article>
			<p>Title: A Legacy Book<br>Author: Ada Example<br>Language: English</p>
			<h1>PART ONE</h1>
			<h2><a name="ch1"></a>Chapter 1</h2>
			<p>The first chapter opens with enough complete English prose to become a useful Reading Source for deliberate typing practice.</p>
			<p>Its second paragraph makes the chapter boundary meaningful rather than leaving a single undifferentiated article.</p>
			<h2><a name="ch2"></a>Chapter 2</h2>
			<p>The second chapter remains independent and contains enough additional English prose for deterministic extraction.</p>
		</article>
	</body>
</html>`;

describe('Import Draft workflow', () => {
	let server: Server;
	let baseUrl: string;
	let draftDirectory: string;
	let pageTwoRequests = 0;

	beforeAll(async () => {
		draftDirectory = await mkdtemp(join(tmpdir(), 'typing-import-'));
		server = createServer((request, response) => {
			switch (request.url) {
				case '/article':
					response.setHeader('Content-Type', 'text/html; charset=utf-8');
					response.end(articleHtml);
					break;
				case '/page-two':
					pageTwoRequests += 1;
					response.setHeader('Content-Type', 'text/html');
					response.end('<html lang="en"><article><p>Must not be fetched.</p></article></html>');
					break;
				case '/legacy-book':
					response.setHeader('Content-Type', 'text/html; charset=utf-8');
					response.end(legacyBookHtml);
					break;
				case '/pdf':
					response.setHeader('Content-Type', 'application/pdf');
					response.end('%PDF-1.7');
					break;
				case '/restricted':
					response.statusCode = 401;
					response.end('Sign in');
					break;
				case '/paywall':
					response.setHeader('Content-Type', 'text/html');
					response.end(
						'<html lang="en"><body><article><div class="paywall">Subscribe</div><p>This otherwise long article is unavailable without payment and must be rejected by the importer.</p></article></body></html>'
					);
					break;
				case '/short':
					response.setHeader('Content-Type', 'text/html');
					response.end('<html lang="en"><body><p>Too short.</p></body></html>');
					break;
				case '/non-english':
					response.setHeader('Content-Type', 'text/html');
					response.end(
						'<html lang="fr"><article><p>Un contenu suffisamment long qui ne doit pas devenir une source de lecture anglaise dans ce catalogue statique.</p></article></html>'
					);
					break;
				default:
					response.statusCode = 404;
					response.end('Not found');
			}
		});
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Fixture server did not start');
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done()))
		);
		await rm(draftDirectory, { recursive: true, force: true });
	});

	async function runImport(path: string) {
		return execute(
			'bun',
			['run', 'import:source', `${baseUrl}${path}`, '--draft-dir', draftDirectory],
			{ cwd: projectRoot }
		);
	}

	it('writes a deterministic, review-only draft with typing-friendly source prose', async () => {
		const catalogBefore = await readFile(join(projectRoot, 'src/lib/catalog.ts'), 'utf8');
		const firstRun = await runImport('/article');
		expect(firstRun.stdout).toContain('has not been Published to the Catalog');

		const files = await readdir(draftDirectory);
		expect(files).toHaveLength(1);
		const firstArtifact = await readFile(join(draftDirectory, files[0]), 'utf8');
		const draft = JSON.parse(firstArtifact) as ImportDraft;

		expect(draft).toMatchObject({
			schemaVersion: 1,
			status: 'draft',
			metadata: {
				title: 'A Patient Morning',
				author: 'Ada Example',
				language: 'en',
				originalUrl: `${baseUrl}/article`
			},
			annotations: [],
			redistributionConfirmed: false
		});
		expect(
			draft.source.sections.flatMap((section) => section.blocks.map((block) => block.text))
		).toEqual([
			'The first bell rang softly, and everyone in the old house paused to listen.',
			'Mina opened the blue curtain. A patient light moved across the wooden floor.',
			"\"Wait-don't...\" Mina's first flame 'flickered\" across a non-breaking path-then\"settled. 'Plain' word-word. A wide and narrow space, plus softhyphen. Keep café, ‚low quotes‚, and € unchanged."
		]);
		expect(firstArtifact).not.toContain('Ignore this');
		expect(pageTwoRequests).toBe(0);

		await runImport('/article');
		expect(await readFile(join(draftDirectory, files[0]), 'utf8')).toBe(firstArtifact);
		expect(await readFile(join(projectRoot, 'src/lib/catalog.ts'), 'utf8')).toBe(catalogBefore);
	});

	it('accepts an explicitly English legacy ebook and preserves chapter sections', async () => {
		await runImport('/legacy-book');
		const file = (await readdir(draftDirectory)).find((name) => name.startsWith('a-legacy-book-'));
		expect(file).toBeDefined();
		const draft = JSON.parse(await readFile(join(draftDirectory, file!), 'utf8')) as ImportDraft;

		expect(draft.metadata.language).toBe('en');
		expect(draft.source.sections.map((section) => section.heading)).toEqual([
			null,
			'Chapter 1',
			'Chapter 2'
		]);
		expect(draft.source.sections[1].blocks).toHaveLength(2);
		expect(draft.source.sections[2].blocks).toHaveLength(1);
	});

	it.each([
		['/pdf', 'PDF sources are not supported'],
		['/restricted', 'restricted, or paywalled'],
		['/paywall', 'restricted, or paywalled'],
		['/short', 'complete Reading Source'],
		['/non-english', 'Only English Reading Sources']
	])('rejects unsupported source %s with an actionable error', async (path, message) => {
		const filesBefore = await readdir(draftDirectory);
		await expect(runImport(path)).rejects.toMatchObject({
			stderr: expect.stringContaining(message)
		});
		expect(await readdir(draftDirectory)).toEqual(filesBefore);
	});

	it('reports unreachable sources without writing a draft', async () => {
		const filesBefore = await readdir(draftDirectory);
		await expect(
			execute(
				'bun',
				['run', 'import:source', 'http://127.0.0.1:1/unreachable', '--draft-dir', draftDirectory],
				{ cwd: projectRoot }
			)
		).rejects.toMatchObject({ stderr: expect.stringContaining('Could not reach') });
		expect(await readdir(draftDirectory)).toEqual(filesBefore);
	});
});
