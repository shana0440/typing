import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { draftSourceText } from './draft.ts';
import type { ImportDraft } from './types.ts';

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function renderBlock(block: ImportDraft['source']['sections'][number]['blocks'][number]): string {
	const text = escapeHtml(block.text);
	switch (block.type) {
		case 'blockquote':
			return `<blockquote>${text}</blockquote>`;
		case 'preformatted':
			return `<pre>${text}</pre>`;
		case 'list-item':
			return `<ul><li>${text}</li></ul>`;
		default:
			return `<p>${text}</p>`;
	}
}

export function renderPreview(draft: ImportDraft): string {
	const text = draftSourceText(draft);
	const sections = draft.source.sections
		.map(
			(section) => `<section>
			${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}
			${section.blocks.map(renderBlock).join('\n')}
		</section>`
		)
		.join('\n');
	const annotations = draft.annotations
		.map((annotation) => {
			const sentence = `${escapeHtml(text.slice(annotation.sentenceStart, annotation.start))}<mark>${escapeHtml(text.slice(annotation.start, annotation.end))}</mark>${escapeHtml(text.slice(annotation.end, annotation.sentenceEnd))}`;
			return `<article class="help"><h3>${escapeHtml(text.slice(annotation.start, annotation.end))}</h3><p lang="zh-Hant">${escapeHtml(annotation.explanationZhTw)}</p><blockquote>${sentence}</blockquote><h4>Generated example</h4><p>${escapeHtml(annotation.generatedExample)}</p></article>`;
		})
		.join('\n');

	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Review: ${escapeHtml(draft.metadata.title)}</title><style>
		body{margin:0;background:#101311;color:#e9ede9;font:16px/1.7 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:56px 32px}a{color:#b9c9bc}.meta{color:#91a293}.grid{display:grid;grid-template-columns:3fr 2fr;gap:48px}section,.help{padding:24px 0;border-top:1px solid #303732}.source p{white-space:pre-wrap;font-family:Georgia,serif}.help{break-inside:avoid}.help h3{font-family:monospace}mark{color:#fff;background:#49604e}@media(max-width:800px){.grid{grid-template-columns:1fr}}
	</style></head><body><main><p class="meta">Import Draft preview</p><h1>${escapeHtml(draft.metadata.title)}</h1><dl><dt>Author</dt><dd>${escapeHtml(draft.metadata.author ?? 'Unknown')}</dd><dt>Language</dt><dd>${draft.metadata.language}</dd><dt>Original URL</dt><dd><a href="${escapeHtml(draft.metadata.originalUrl)}">${escapeHtml(draft.metadata.originalUrl)}</a></dd></dl><div class="grid"><div class="source"><h2>Exact source</h2>${sections}</div><aside><h2>Word Help (${draft.annotations.length})</h2>${annotations || '<p>No annotations proposed.</p>'}</aside></div></main></body></html>`;
}

function openBrowser(url: string): void {
	if (process.env.IMPORT_PREVIEW_NO_OPEN === '1') return;
	const command =
		process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const child = spawn(command, args, { detached: true, stdio: 'ignore' });
	child.on('error', () => {
		// The terminal still prints the preview URL when no system opener is available.
	});
	child.unref();
}

export async function startPreview(
	draft: ImportDraft
): Promise<{ url: string; close: () => Promise<void> }> {
	const html = renderPreview(draft);
	const server = createServer((_request, response) => {
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(html);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Preview server did not start.');
	const url = `http://127.0.0.1:${address.port}`;
	openBrowser(url);
	return {
		url,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			)
	};
}
