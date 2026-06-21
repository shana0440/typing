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
		case 'figure-caption':
			return `<figure><figcaption>${text}</figcaption></figure>`;
		case 'table-text':
			return `<p class="table-text">${text}</p>`;
		default:
			return `<p>${text}</p>`;
	}
}

function verificationCandidate(
	candidate: ImportDraft['candidates'][number],
	selected: boolean
): string {
	const sections = candidate.sections
		.map(
			(section) =>
				`<section>${section.heading ? `<h3>${escapeHtml(section.heading)}</h3>` : ''}${section.blocks.map(renderBlock).join('')}</section>`
		)
		.join('');
	return `<article class="candidate"><label><input type="radio" name="candidate" value="${escapeHtml(candidate.id)}" ${selected ? 'checked' : ''} required> <strong>${escapeHtml(candidate.label)}</strong> <span class="badge">score ${candidate.score}</span></label><p class="meta">Origin: ${escapeHtml(candidate.origin)} | ${candidate.characterCount} characters | ${candidate.blockCount} blocks</p>${candidate.warnings.length ? `<ul class="warnings">${candidate.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '<p class="meta">No extraction warnings.</p>'}<details ${selected ? 'open' : ''}><summary>Structured preview</summary><div class="source">${sections}</div></details></article>`;
}

export function renderVerification(draft: ImportDraft, error = ''): string {
	const titleSuggestions = draft.metadata.titleSuggestions
		.map(
			(entry) =>
				`<li>${escapeHtml(entry.value)} <span class="meta">(${escapeHtml(entry.origin)})</span></li>`
		)
		.join('');
	const authorSuggestions = draft.metadata.authorSuggestions
		.map(
			(entry) =>
				`<li>${escapeHtml(entry.value)} <span class="meta">(${escapeHtml(entry.origin)})</span></li>`
		)
		.join('');
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Source Verification</title><style>
	body{margin:0;background:#101311;color:#e9ede9;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 28px}a{color:#b9d7c0}.meta{color:#9baa9e}.error,.warnings{color:#ffbdad}.candidate{margin:24px 0;padding:24px;border:1px solid #344139;border-radius:8px}.candidate:has(input:checked){border-color:#8fb89a}.badge{padding:3px 7px;background:#26342b;border-radius:4px}.source{max-height:55vh;overflow:auto;padding:20px;background:#161c18}.source p,.source blockquote{white-space:pre-wrap;font-family:Georgia,serif}.fields{display:grid;grid-template-columns:1fr 1fr;gap:20px}input[type=text]{box-sizing:border-box;width:100%;padding:10px;background:#171d19;color:#fff;border:1px solid #536158}button{padding:11px 16px;border:0;border-radius:5px;background:#b8d5be;color:#122016;font-weight:700}button.reject{background:#4b302d;color:#ffd9d2}@media(max-width:700px){.fields{grid-template-columns:1fr}}
	</style></head><body><main><p class="meta">Source Verification</p><h1>Choose one complete candidate</h1>${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}<dl><dt>Requested URL</dt><dd>${escapeHtml(draft.metadata.requestedUrl)}</dd><dt>Final URL</dt><dd><a target="_blank" rel="noreferrer" href="${escapeHtml(draft.metadata.originalUrl)}">${escapeHtml(draft.metadata.finalUrl ?? 'Unavailable')}</a></dd><dt>Page canonical URL</dt><dd>${escapeHtml(draft.metadata.canonicalUrl ?? 'Not declared')}</dd><dt>Response</dt><dd>${draft.diagnostics.httpStatus ?? 'none'}; ${escapeHtml(draft.diagnostics.contentType ?? 'content type not declared')}</dd></dl><form method="post"><div class="fields"><label>Title (required)<input name="title" type="text" required value="${escapeHtml(draft.metadata.title)}"></label><label>Author (optional)<input name="author" type="text" value="${escapeHtml(draft.metadata.author ?? '')}"></label></div><details><summary>Metadata suggestions</summary><h3>Titles</h3><ul>${titleSuggestions || '<li>None</li>'}</ul><h3>Authors</h3><ul>${authorSuggestions || '<li>None</li>'}</ul></details>${draft.candidates.map((candidate) => verificationCandidate(candidate, candidate.id === draft.selectedCandidateId)).join('')}<button name="action" value="approve">Approve selected candidate</button> <button class="reject" name="action" value="reject" formnovalidate>Reject all candidates</button></form></main></body></html>`;
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
