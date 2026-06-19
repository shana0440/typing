<script lang="ts">
	import { catalog, findSource, sourceText, type WordHelpAnnotation } from '$lib/catalog';
	import {
		clearSourceProgress,
		progressForSource,
		readProgress,
		saveSourceProgress
	} from '$lib/progress';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';

	const sourceId = $derived(
		browser ? (page.url.searchParams.get('source') ?? catalog[0].id) : catalog[0].id
	);
	const source = $derived(findSource(sourceId));
	const text = $derived(source ? sourceText(source) : '');
	let position = $state(0);
	let error = $state<string | null>(null);
	let completed = $state(false);
	let completedAt = $state<string | null>(null);
	let hydrated = $state(false);
	let activeHelp = $state<WordHelpAnnotation | null>(null);
	let helpMessage = $state<string | null>(null);
	let typingStage = $state<HTMLElement>();
	let helpPanel = $state<HTMLElement>();

	const progress = $derived(text.length === 0 ? 0 : Math.round((position / text.length) * 100));
	const sectionTitle = $derived(source?.sections[0]?.title ?? '');
	const completionDate = $derived(
		completedAt
			? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(completedAt))
			: ''
	);
	const helpSentence = $derived(
		activeHelp
			? {
					before: text.slice(activeHelp.sentenceStart, activeHelp.start),
					term: text.slice(activeHelp.start, activeHelp.end),
					after: text.slice(activeHelp.end, activeHelp.sentenceEnd)
				}
			: null
	);

	onMount(() => {
		if (source) {
			const saved = progressForSource(readProgress(localStorage), source);
			if (saved) {
				position = saved.position;
				completedAt = saved.completedAt;
				completed = saved.position === text.length;
			}
		}
		hydrated = true;
		if (!completed) focusTypingStage();
	});

	function skipParagraphBoundaries() {
		while (text[position] === '\n') position += 1;
	}

	async function keepCurrentPositionVisible() {
		await tick();
		document.querySelector('.current-character')?.scrollIntoView({ block: 'center' });
	}

	async function focusTypingStage() {
		await keepCurrentPositionVisible();
		typingStage?.focus({ preventScroll: true });
	}

	async function openHelp() {
		if (!source) return;
		const annotation = source.wordHelp.find(
			(candidate) => position >= candidate.start && position < candidate.end
		);
		if (!annotation) {
			helpMessage = 'No Word Help was prepared for this position.';
			return;
		}

		helpMessage = null;
		error = null;
		activeHelp = annotation;
		await tick();
		helpPanel?.focus({ preventScroll: true });
	}

	function closeHelp() {
		activeHelp = null;
		focusTypingStage();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!source || !hydrated || completed) return;
		if (event.ctrlKey || event.metaKey) return;

		if (activeHelp) {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeHelp();
			} else if (event.key.length === 1) {
				event.preventDefault();
			}
			return;
		}

		if (event.altKey && event.key.toLowerCase() === 'h') {
			event.preventDefault();
			openHelp();
			return;
		}

		if (event.altKey) return;
		if (event.key.length !== 1) return;

		event.preventDefault();
		if (event.key !== text[position]) {
			error = event.key;
			helpMessage = null;
			return;
		}

		error = null;
		helpMessage = null;
		const positionAfterInput = position + 1;
		position += 1;
		skipParagraphBoundaries();
		if (position >= text.length) {
			completedAt = new Date().toISOString();
			completed = true;
			saveSourceProgress(localStorage, source, position, completedAt, completedAt);
		} else {
			if (event.key === ' ' || position > positionAfterInput) {
				saveSourceProgress(localStorage, source, position, new Date().toISOString());
			}
			keepCurrentPositionVisible();
		}
	}

	function restart() {
		if (source) clearSourceProgress(localStorage, source.id);
		position = 0;
		error = null;
		completed = false;
		completedAt = null;
		activeHelp = null;
		helpMessage = null;
		focusTypingStage();
	}
</script>

<svelte:head>
	<title>{source ? `${source.title} | Typing Practice` : 'Reading Source not found'}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#if !source}
	<main class="not-found">
		<p class="eyebrow">Catalog</p>
		<h1>Reading Source not found</h1>
		<a class="primary-action" href={resolve('/')}>Return to Catalog</a>
	</main>
{:else if !hydrated}
	<main class="session-loading" aria-live="polite">
		<p>Loading Reading Progress...</p>
	</main>
{:else if completed}
	<main class="completion-view" aria-live="polite">
		<p class="eyebrow">Reading complete</p>
		<h1>{source.title}</h1>
		<p>Completed <time datetime={completedAt ?? undefined}>{completionDate}</time></p>
		<div class="completion-actions">
			<a class="secondary-action" href={resolve('/')}>Return to Catalog</a>
			<button class="primary-action" type="button" onclick={restart}>Read again</button>
		</div>
	</main>
{:else}
	<main class="session-page">
		<header class="session-header">
			<a class="catalog-link" href={resolve('/')} aria-label="Return to Catalog">Catalog</a>
			<div class="source-context">
				<strong>{source.title}</strong>
				<span>{sectionTitle}</span>
			</div>
			<div class="progress-context" aria-label={`${progress}% complete`}>
				<span>{progress}%</span>
				<div class="progress-track">
					<div class="progress-fill" style:width={`${progress}%`}></div>
				</div>
			</div>
		</header>

		<section class="typing-stage" aria-label="Typing Session" tabindex="-1" bind:this={typingStage}>
			<p class="keyboard-hint">Type to continue</p>
			<div class="text-viewport">
				<div class="source-text" aria-label="Reading Source text">
					{#each Array.from(text) as character, index (index)}
						{#if character === '\n'}
							<br aria-hidden="true" />
						{:else}
							<span
								class:completed-character={index < position}
								class:current-character={index === position}
								class:typing-error={index === position && error !== null}>{character}</span
							>
						{/if}
					{/each}
				</div>
			</div>
			<p
				class:error-visible={error !== null || helpMessage !== null}
				class="error-message"
				role="status"
			>
				{error !== null
					? `Expected ${JSON.stringify(text[position])}. Try again.`
					: (helpMessage ?? ' ')}
			</p>
		</section>

		{#if activeHelp && helpSentence}
			<div class="help-backdrop" aria-hidden="true"></div>
			<div
				class="word-help"
				role="dialog"
				aria-modal="true"
				aria-labelledby="word-help-title"
				tabindex="-1"
				bind:this={helpPanel}
			>
				<header class="word-help-header">
					<div>
						<p class="eyebrow">Word Help</p>
						<h2 id="word-help-title">{helpSentence.term}</h2>
					</div>
					<button class="close-help" type="button" onclick={closeHelp} aria-label="Close Word Help"
						>Escape</button
					>
				</header>

				<p class="help-explanation" lang="zh-Hant">{activeHelp.explanationZhTw}</p>

				<div class="help-section">
					<h3>In this source</h3>
					<blockquote>
						{helpSentence.before}<mark>{helpSentence.term}</mark>{helpSentence.after}
					</blockquote>
				</div>

				<div class="help-section">
					<h3>Generated example</h3>
					<p>{activeHelp.generatedExample}</p>
				</div>
			</div>
		{/if}
	</main>
{/if}
