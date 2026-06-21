import { createHash } from 'node:crypto';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type {
	CandidateOrigin,
	ExtractionCandidate,
	ImportBlock,
	ImportDraft,
	ImportSection,
	MetadataSuggestion
} from './types.ts';

const REQUEST_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9'
};
const EXCLUDED =
	'script,style,template,noscript,form,nav,footer,aside,audio,video,iframe,embed,object,picture,svg,canvas,[hidden],[aria-hidden="true"],[style*="display:none" i],[style*="display: none" i],[style*="visibility:hidden" i],[style*="visibility: hidden" i],[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"]';
const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,pre,li,figcaption,table';
const REPLACEMENTS: Readonly<Record<string, string>> = {
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
const REPLACE_CHARACTER =
	/[\u00a0\u00ad\u2010\u2011\u2013\u2014\u2018\u2019\u201b\u201c\u201d\u201e\u201f\u2026\u202f\ufb01\ufb02]/gu;

export class ImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportError';
	}
}

export type ImportAttempt = { draft: ImportDraft; snapshot: string | null };

export function requireImportUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new ImportError('Provide one valid HTTP or HTTPS URL.');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new ImportError('Only public HTTP or HTTPS URLs without credentials are supported.');
	}
	return url;
}

function friendly(value: string): string {
	return value.replaceAll('\r\n', '\n').replace(REPLACE_CHARACTER, (c) => REPLACEMENTS[c]);
}

function ordinaryText(element: Element): string {
	const clone = element.cloneNode(true) as Element;
	for (const br of clone.querySelectorAll('br')) br.replaceWith('\n');
	return friendly(clone.textContent ?? '')
		.split('\n')
		.map((line) => line.replace(/[\t \f\v]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function textFor(element: Element): string {
	if (element.tagName.toLowerCase() === 'pre') return friendly(element.textContent ?? '').trim();
	if (element.tagName.toLowerCase() === 'table') {
		return [...element.querySelectorAll('tr')]
			.map((row) =>
				[...row.querySelectorAll(':scope > th,:scope > td')]
					.map(ordinaryText)
					.filter(Boolean)
					.join('\t')
			)
			.filter(Boolean)
			.join('\n');
	}
	return ordinaryText(element);
}

function blockType(element: Element): ImportBlock['type'] {
	switch (element.tagName.toLowerCase()) {
		case 'blockquote':
			return 'blockquote';
		case 'pre':
			return 'preformatted';
		case 'li':
			return 'list-item';
		case 'figcaption':
			return 'figure-caption';
		case 'table':
			return 'table-text';
		default:
			return 'paragraph';
	}
}

function clean(root: Element): Element {
	const clone = root.cloneNode(true) as Element;
	for (const node of clone.querySelectorAll(EXCLUDED)) node.remove();
	return clone;
}

export function extractSections(root: Element): ImportSection[] {
	const cleanedRoot = clean(root);
	const sections: ImportSection[] = [];
	let current: ImportSection = { id: 'section-1', heading: null, blocks: [] };
	for (const element of cleanedRoot.querySelectorAll(BLOCK_SELECTOR)) {
		if (
			element.parentElement?.closest('blockquote,li,table') &&
			!['BLOCKQUOTE', 'LI', 'TABLE'].includes(element.tagName)
		)
			continue;
		const text = textFor(element);
		if (!text) continue;
		if (/^H[1-6]$/.test(element.tagName)) {
			if (current.blocks.length) sections.push(current);
			current = { id: `section-${sections.length + 1}`, heading: text, blocks: [] };
		} else current.blocks.push({ type: blockType(element), text });
	}
	if (current.blocks.length) sections.push(current);
	if (!sections.length) {
		const text = ordinaryText(cleanedRoot);
		if (text)
			sections.push({ id: 'section-1', heading: null, blocks: [{ type: 'paragraph', text }] });
	}
	return sections;
}

function stats(sections: ImportSection[]) {
	const blocks = sections.flatMap((section) => section.blocks);
	return {
		characterCount: blocks.reduce((sum, block) => sum + block.text.length, 0),
		blockCount: blocks.length
	};
}

function candidateWarnings(
	root: Element,
	sections: ImportSection[],
	linkDensity: number
): string[] {
	const warnings: string[] = [];
	const texts = sections.flatMap((s) => s.blocks.map((b) => b.text));
	if (linkDensity > 0.35) warnings.push('Suspicious link density');
	if (new Set(texts).size < texts.length) warnings.push('Repeated blocks are present');
	if (root.querySelector('nav,footer,aside')) warnings.push('Candidate may include page chrome');
	if (
		/\b(continued|read more|next page|page \d+ of \d+)\b/i.test(root.textContent ?? '') ||
		root.querySelector('link[rel="next"],a[rel="next"]')
	)
		warnings.push('Possible continuation or pagination');
	if (texts.some((text) => /(?:\.\.\.|…|\bcontinued\b)\s*$/i.test(text)))
		warnings.push('Possible truncation or abrupt ending');
	return warnings;
}

function makeCandidate(
	root: Element,
	origin: CandidateOrigin,
	index: number
): ExtractionCandidate | null {
	const sections = extractSections(root);
	const { characterCount, blockCount } = stats(sections);
	if (!characterCount || !blockCount) return null;
	const allText = ordinaryText(root);
	const linkText = [...root.querySelectorAll('a')].reduce(
		(n, link) => n + ordinaryText(link).length,
		0
	);
	const linkDensity = allText.length ? linkText / allText.length : 0;
	const semantic = { readability: 45, 'semantic-article': 40, 'semantic-main': 35, body: 10 }[
		origin
	];
	const density = Math.min(25, characterCount / Math.max(1, root.querySelectorAll('*').length) / 4);
	const structure = Math.min(20, blockCount * 2);
	const score = Math.round((semantic + density + structure - linkDensity * 40) * 100) / 100;
	return {
		id: `${origin}-${index + 1}`,
		origin,
		label: {
			readability: 'Readability',
			'semantic-article': 'Semantic article',
			'semantic-main': 'Semantic main',
			body: 'Cleaned document body'
		}[origin],
		score,
		sections,
		characterCount,
		blockCount,
		warnings: candidateWarnings(root, sections, linkDensity)
	};
}

function suggestions(document: Document, selectors: Array<[string, string]>): MetadataSuggestion[] {
	const values: MetadataSuggestion[] = [];
	for (const [origin, selector] of selectors) {
		const node = document.querySelector(selector);
		const value = (node?.getAttribute('content') ?? node?.textContent ?? '').trim();
		if (value && !values.some((entry) => entry.value === value)) values.push({ value, origin });
	}
	return values;
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

function draftId(
	requestedUrl: string,
	finalUrl: string | null,
	candidates: ExtractionCandidate[]
): string {
	const identity = createHash('sha256')
		.update(`${requestedUrl}\0${finalUrl ?? ''}\0${JSON.stringify(candidates)}`)
		.digest('hex')
		.slice(0, 12);
	return identity;
}

function baseDraft(requestedUrl: string, now: string): ImportDraft {
	const identity = createHash('sha256').update(requestedUrl).digest('hex').slice(0, 12);
	return {
		schemaVersion: 2,
		status: 'blocked',
		id: `source-${identity}`,
		metadata: {
			title: '',
			author: null,
			language: 'en',
			requestedUrl,
			finalUrl: null,
			canonicalUrl: null,
			originalUrl: requestedUrl,
			titleSuggestions: [],
			authorSuggestions: []
		},
		candidates: [],
		selectedCandidateId: null,
		source: { sections: [] },
		blocked: null,
		diagnostics: {
			fetchedAt: now,
			httpStatus: null,
			contentType: null,
			redirected: false,
			messages: []
		},
		annotations: [],
		redistributionConfirmed: false
	};
}

export async function createImportAttempt(
	input: string,
	fetchPage: typeof fetch = fetch
): Promise<ImportAttempt> {
	const requested = requireImportUrl(input);
	const draft = baseDraft(requested.href, new Date().toISOString());
	let response: Response;
	try {
		response = await fetchPage(requested, {
			headers: REQUEST_HEADERS,
			redirect: 'follow',
			credentials: 'omit'
		});
	} catch (error) {
		draft.blocked = {
			reason: 'fetch-failed',
			diagnostic: `Could not fetch source: ${error instanceof Error ? error.message : 'request failed'}`
		};
		draft.diagnostics.messages.push(draft.blocked.diagnostic);
		return { draft, snapshot: null };
	}
	draft.diagnostics.httpStatus = response.status;
	draft.diagnostics.contentType = response.headers.get('content-type');
	draft.metadata.finalUrl = response.url || requested.href;
	draft.metadata.originalUrl = draft.metadata.finalUrl;
	draft.diagnostics.redirected = draft.metadata.finalUrl !== requested.href;
	const snapshot = await response.text();
	if ([401, 403, 407, 451].includes(response.status)) {
		draft.blocked = {
			reason: 'access-denied',
			diagnostic: `Source access was denied with HTTP ${response.status}.`
		};
		draft.diagnostics.messages.push(draft.blocked.diagnostic);
		return { draft, snapshot };
	}
	if (!response.ok) {
		draft.blocked = {
			reason: 'fetch-failed',
			diagnostic: `Source request failed with HTTP ${response.status}.`
		};
		draft.diagnostics.messages.push(draft.blocked.diagnostic);
		return { draft, snapshot };
	}

	const dom = new JSDOM(snapshot, { url: draft.metadata.finalUrl });
	const document = dom.window.document;
	const canonical = document.querySelector('link[rel="canonical" i]')?.getAttribute('href');
	if (canonical) {
		try {
			draft.metadata.canonicalUrl = new URL(canonical, draft.metadata.finalUrl).href;
		} catch {
			draft.diagnostics.messages.push('The page declared an invalid canonical URL.');
		}
	}
	const titleSuggestions = suggestions(document, [
		['Open Graph', 'meta[property="og:title"]'],
		['standard metadata', 'meta[name="title"]'],
		['document title', 'title'],
		['first heading', 'h1']
	]);
	const authorSuggestions = suggestions(document, [
		['Open Graph', 'meta[property="article:author"],meta[name="og:author"]'],
		['standard metadata', 'meta[name="author"]'],
		['rel author', '[rel="author"]']
	]);
	const candidates: ExtractionCandidate[] = [];
	const readability = new Readability(document.cloneNode(true) as Document, {
		charThreshold: 0
	}).parse();
	if (readability?.content) {
		const root = new JSDOM(`<main>${readability.content}</main>`).window.document.querySelector(
			'main'
		)!;
		const candidate = makeCandidate(root, 'readability', 0);
		if (candidate) candidates.push(candidate);
		const readabilityTitle = readability.title?.trim();
		const readabilityAuthor = readability.byline?.trim();
		if (readabilityTitle && !titleSuggestions.some((x) => x.value === readabilityTitle))
			titleSuggestions.push({ value: readabilityTitle, origin: 'Readability' });
		if (readabilityAuthor && !authorSuggestions.some((x) => x.value === readabilityAuthor))
			authorSuggestions.push({ value: readabilityAuthor, origin: 'Readability' });
	}
	for (const [origin, nodes] of [
		['semantic-article', document.querySelectorAll('article')],
		['semantic-main', document.querySelectorAll('main')]
	] as const) {
		for (const [index, node] of [...nodes].entries()) {
			const candidate = makeCandidate(node, origin, index);
			if (candidate) candidates.push(candidate);
		}
	}
	if (document.body) {
		const candidate = makeCandidate(document.body, 'body', 0);
		if (candidate) candidates.push(candidate);
	}
	candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	draft.candidates = candidates;
	draft.metadata.titleSuggestions = titleSuggestions;
	draft.metadata.authorSuggestions = authorSuggestions;
	draft.metadata.title = titleSuggestions[0]?.value ?? '';
	draft.metadata.author = authorSuggestions[0]?.value ?? null;
	if (!candidates.length) {
		draft.blocked = {
			reason: 'no-usable-candidate',
			diagnostic: 'Static HTML did not yield a usable textual extraction candidate.'
		};
		draft.diagnostics.messages.push(draft.blocked.diagnostic);
		return { draft, snapshot };
	}
	draft.status = 'extracted';
	draft.selectedCandidateId = candidates[0].id;
	draft.source.sections = structuredClone(candidates[0].sections);
	draft.blocked = null;
	const identity = draftId(requested.href, draft.metadata.finalUrl, candidates);
	draft.id = `${slug(draft.metadata.title)}-${identity}`;
	return { draft, snapshot };
}

export async function createImportDraft(
	input: string,
	fetchPage: typeof fetch = fetch
): Promise<ImportDraft> {
	return (await createImportAttempt(input, fetchPage)).draft;
}
