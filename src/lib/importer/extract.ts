import { createHash } from 'node:crypto';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ImportBlock, ImportDraft, ImportSection } from './types.ts';

const MINIMUM_SOURCE_LENGTH = 80;
const TYPING_FRIENDLY_REPLACEMENTS: Readonly<Record<string, string>> = {
	'\u2018': "'",
	'\u2019': "'",
	'\u201b': "'",
	'\u201c': '"',
	'\u201d': '"',
	'\u201e': '"',
	'\u201f': '"',
	'\u2010': '-',
	'\u2011': '-',
	'\u2013': '-',
	'\u2014': '-',
	'\u2026': '...',
	'\u00a0': ' ',
	'\u202f': ' ',
	'\ufb01': 'fi',
	'\ufb02': 'fl',
	'\u00ad': ''
};
const TYPING_FRIENDLY_CHARACTER =
	/[\u00a0\u00ad\u2010\u2011\u2013\u2014\u2018\u2019\u201b\u201c\u201d\u201e\u201f\u2026\u202f\ufb01\ufb02]/gu;

export class ImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportError';
	}
}

function requireImportUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new ImportError('Provide one valid HTTP or HTTPS URL.');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new ImportError('Only public HTTP or HTTPS URLs without credentials are supported.');
	}
	if (url.pathname.toLowerCase().endsWith('.pdf')) {
		throw new ImportError('PDF sources are not supported; provide one complete HTML page.');
	}
	return url;
}

function normalizedText(element: Element): string {
	return (element.textContent ?? '')
		.replaceAll('\r\n', '\n')
		.replace(TYPING_FRIENDLY_CHARACTER, (character) => TYPING_FRIENDLY_REPLACEMENTS[character])
		.trim();
}

function blockType(element: Element): ImportBlock['type'] {
	switch (element.tagName.toLowerCase()) {
		case 'blockquote':
			return 'blockquote';
		case 'pre':
			return 'preformatted';
		case 'li':
			return 'list-item';
		default:
			return 'paragraph';
	}
}

function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'source'
	);
}

function extractSections(content: string): ImportSection[] {
	const document = new JSDOM(`<main>${content}</main>`).window.document;
	const sections: ImportSection[] = [];
	let current: ImportSection = { id: 'section-1', heading: null, blocks: [] };

	for (const element of document.querySelectorAll(
		'h1, h2, h3, h4, h5, h6, p, blockquote, pre, li'
	)) {
		if (element.closest('blockquote') !== element && element.closest('blockquote')) continue;
		if (element.closest('li') !== element && element.closest('li')) continue;

		const text = normalizedText(element);
		if (!text) continue;
		if (/^H[1-6]$/.test(element.tagName)) {
			if (current.blocks.length > 0 || current.heading !== null) sections.push(current);
			current = { id: `section-${sections.length + 1}`, heading: text, blocks: [] };
		} else {
			current.blocks.push({ type: blockType(element), text });
		}
	}

	if (current.blocks.length > 0 || current.heading !== null) sections.push(current);
	return sections.filter((section) => section.blocks.length > 0);
}

function sourceLength(sections: ImportSection[]): number {
	return sections.reduce(
		(total, section) => total + section.blocks.reduce((sum, block) => sum + block.text.length, 0),
		0
	);
}

export async function createImportDraft(
	input: string,
	fetchPage: typeof fetch = fetch
): Promise<ImportDraft> {
	const requestedUrl = requireImportUrl(input);
	let response: Response;
	try {
		response = await fetchPage(requestedUrl, {
			headers: { Accept: 'text/html,application/xhtml+xml' },
			redirect: 'follow'
		});
	} catch (error) {
		throw new ImportError(
			`Could not reach ${requestedUrl.href}: ${error instanceof Error ? error.message : 'request failed'}`
		);
	}

	if ([401, 403].includes(response.status)) {
		throw new ImportError('Authenticated, restricted, or paywalled pages are not supported.');
	}
	if (!response.ok) {
		throw new ImportError(`Source request failed with HTTP ${response.status}.`);
	}

	const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
	if (contentType.includes('application/pdf')) {
		throw new ImportError('PDF sources are not supported; provide one complete HTML page.');
	}
	if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
		throw new ImportError(`Unsupported content type: ${contentType || 'unknown'}. Expected HTML.`);
	}

	const originalUrl = response.url || requestedUrl.href;
	const html = await response.text();
	const dom = new JSDOM(html, { url: originalUrl });
	const document = dom.window.document;
	if (document.querySelector('[class*="paywall" i], [id*="paywall" i], input[type="password"]')) {
		throw new ImportError('Authenticated, restricted, or paywalled pages are not supported.');
	}

	const language = document.documentElement.lang.trim().toLowerCase();
	if (!language.startsWith('en')) {
		throw new ImportError(
			language
				? `Only English Reading Sources are supported; the page declares "${language}".`
				: 'The page must declare English with an HTML lang attribute.'
		);
	}

	const article = new Readability(document.cloneNode(true) as Document, {
		charThreshold: MINIMUM_SOURCE_LENGTH
	}).parse();
	const title = article?.title?.trim();
	if (!title || !article?.content) {
		throw new ImportError('Could not extract a complete Reading Source from this page.');
	}

	const sections = extractSections(article.content);
	if (sections.length === 0 || sourceLength(sections) < MINIMUM_SOURCE_LENGTH) {
		throw new ImportError('Extracted source is incomplete or too short to review.');
	}

	const identity = createHash('sha256')
		.update(`${originalUrl}\0${JSON.stringify(sections)}`)
		.digest('hex')
		.slice(0, 12);

	return {
		schemaVersion: 1,
		status: 'draft',
		id: `${slug(title)}-${identity}`,
		metadata: {
			title,
			author: article.byline?.trim() || null,
			language: 'en',
			originalUrl
		},
		source: { sections },
		annotations: [],
		redistributionConfirmed: false
	};
}
