import { createServer, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import type { ImportDraft } from './types.ts';
import { rejectImportDraft, verifyImportDraft } from './draft.ts';
import { renderVerification } from './preview.ts';

function openBrowser(url: string): void {
	if (process.env.IMPORT_PREVIEW_NO_OPEN === '1') return;
	const command =
		process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const child = spawn(command, args, { detached: true, stdio: 'ignore' });
	child.on('error', () => {});
	child.unref();
}

async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
	let body = '';
	for await (const chunk of request) body += chunk;
	return new URLSearchParams(body);
}

export async function startSourceVerification(draft: ImportDraft): Promise<{
	url: string;
	result: Promise<ImportDraft>;
	close: () => Promise<void>;
}> {
	let finish!: (draft: ImportDraft) => void;
	const result = new Promise<ImportDraft>((resolve) => (finish = resolve));
	const server = createServer(async (request, response) => {
		if (request.method === 'POST') {
			const form = await formBody(request);
			try {
				if (form.get('action') === 'reject') rejectImportDraft(draft);
				else
					verifyImportDraft(draft, {
						candidateId: form.get('candidate') ?? '',
						title: form.get('title') ?? '',
						author: form.get('author')
					});
				response.writeHead(303, { Location: '/complete' }).end();
				finish(draft);
			} catch (error) {
				response.statusCode = 400;
				response.end(
					renderVerification(draft, error instanceof Error ? error.message : String(error))
				);
			}
			return;
		}
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(
			request.url === '/complete'
				? '<!doctype html><title>Source Verification complete</title><p>Source Verification recorded. You may close this tab.</p>'
				: renderVerification(draft)
		);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Verification server did not start.');
	const url = `http://127.0.0.1:${address.port}`;
	openBrowser(draft.metadata.originalUrl);
	openBrowser(url);
	return {
		url,
		result,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			)
	};
}
