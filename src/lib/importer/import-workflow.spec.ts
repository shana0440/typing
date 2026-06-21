import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImportAttempt, requireImportUrl } from './extract.ts';

const html = `<!doctype html><html lang="fr"><head><title>Short Post</title><meta name="author" content="Ada"><link rel="canonical" href="/canonical"></head><body><nav>Chrome</nav><main><article><h1>Short Post</h1><p>Wait—don't…</p><pre>one\n  two</pre><p>Repeat me.</p><p>Repeat me.</p><a rel="next" href="/two">Next page</a></article></main><script>globalThis.bad=true</script></body></html>`;

describe('generic webpage extraction', () => {
	let server: Server;
	let baseUrl: string;
	let nextRequests = 0;

	beforeAll(async () => {
		server = createServer((request, response) => {
			if (request.url === '/redirect') {
				response.statusCode = 302;
				response.setHeader('Location', '/post');
				return response.end();
			}
			if (request.url === '/post') {
				response.setHeader('Content-Type', 'application/octet-stream');
				return response.end(html);
			}
			if (request.url === '/denied') {
				response.statusCode = 403;
				return response.end('denied');
			}
			if (request.url === '/empty') return response.end('<html><script>only()</script></html>');
			if (request.url === '/minimal')
				return response.end(
					'<html><body><div>A tiny static social post.</div><div hidden>Secret</div><video>Media fallback</video></body></html>'
				);
			if (request.url === '/two') nextRequests += 1;
			response.statusCode = 404;
			response.end('missing');
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('fixture server failed');
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('accepts short static HTML despite content type and language declarations', async () => {
		const { draft, snapshot } = await createImportAttempt(`${baseUrl}/redirect`);
		expect(snapshot).toContain('<title>Short Post</title>');
		expect(draft).toMatchObject({
			schemaVersion: 2,
			status: 'extracted',
			metadata: {
				requestedUrl: `${baseUrl}/redirect`,
				finalUrl: `${baseUrl}/post`,
				canonicalUrl: `${baseUrl}/canonical`,
				title: 'Short Post',
				author: 'Ada'
			},
			diagnostics: { contentType: 'application/octet-stream', redirected: true },
			annotations: []
		});
		expect(draft.candidates.map((candidate) => candidate.origin)).toEqual(
			expect.arrayContaining(['readability', 'semantic-article', 'semantic-main', 'body'])
		);
		expect(
			draft.source.sections.flatMap((section) => section.blocks.map((block) => block.text))
		).toEqual(expect.arrayContaining(["Wait-don't...", 'one\n  two', 'Repeat me.', 'Repeat me.']));
		expect(
			draft.candidates.some((candidate) =>
				candidate.warnings.some((warning) => warning.includes('Repeated'))
			)
		).toBe(true);
		expect(nextRequests).toBe(0);
	});

	it.each([
		['/denied', 'access-denied'],
		['/empty', 'no-usable-candidate']
	])('persists blocked reason for %s', async (path, reason) => {
		const { draft } = await createImportAttempt(`${baseUrl}${path}`);
		expect(draft).toMatchObject({ status: 'blocked', blocked: { reason } });
	});

	it('persists fetch failures', async () => {
		const { draft } = await createImportAttempt('http://127.0.0.1:1/unreachable');
		expect(draft).toMatchObject({ status: 'blocked', blocked: { reason: 'fetch-failed' } });
	});

	it('uses a generic-container fallback without hidden or media text', async () => {
		const { draft } = await createImportAttempt(`${baseUrl}/minimal`);
		expect(draft.status).toBe('extracted');
		expect(draft.source.sections[0].blocks[0].text).toBe('A tiny static social post.');
	});

	it.each(['file:///tmp/source', 'data:text/html,test', 'https://user:pass@example.com'])(
		'rejects non-public URL %s',
		(url) => {
			expect(() => requireImportUrl(url)).toThrow('without credentials');
		}
	);
});
