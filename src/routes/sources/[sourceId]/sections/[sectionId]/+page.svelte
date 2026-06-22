<script lang="ts">
	import type { WordHelpAnnotation } from '$lib/catalog';
	import {
		clearSectionProgress,
		isWordBoundary,
		progressForSection,
		readProgress,
		saveSectionProgress
	} from '$lib/progress';
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let { data } = $props();
	const source = $derived(data.source);
	const section = $derived(data.section.content);
	const text = $derived(section.text);
	let position = $state(0);
	let error = $state<{ expected: string; actual: string } | null>(null);
	let incorrectPositions = new SvelteSet<number>();
	let completed = $state(false);
	let completedAt = $state<string | null>(null);
	let hydrated = $state(false);
	let activeHelp = $state<WordHelpAnnotation | null>(null);
	let helpMessage = $state<string | null>(null);
	let typingStage = $state<HTMLElement>();
	let helpPanel = $state<HTMLElement>();

	const progress = $derived(text.length === 0 ? 0 : Math.round((position / text.length) * 100));
	const sectionTitle = $derived(section.title);
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
			const saved = progressForSection(readProgress(localStorage), source.id, section);
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
		const annotation = data.section.wordHelp.find(
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

	function handleBackspace(event: KeyboardEvent) {
		event.preventDefault();
		if (!source || position === 0) return;

		position -= 1;
		while (position > 0 && text[position] === '\n') position -= 1;
		incorrectPositions.delete(position);
		error = null;
		helpMessage = null;

		const saved = progressForSection(readProgress(localStorage), source.id, section);
		let resumablePosition = position;
		while (resumablePosition > 0 && !isWordBoundary(text, resumablePosition)) {
			resumablePosition -= 1;
		}
		if (saved && saved.position > resumablePosition) {
			if (resumablePosition === 0) {
				clearSectionProgress(localStorage, source.id, section.id);
			} else {
				saveSectionProgress(
					localStorage,
					source.id,
					section,
					resumablePosition,
					new Date().toISOString()
				);
			}
		}
		keepCurrentPositionVisible();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!source || !hydrated || completed) return;
		if (event.ctrlKey || event.metaKey) return;

		if (activeHelp) {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeHelp();
			} else if (event.key === 'Backspace' || event.key.length === 1) {
				event.preventDefault();
			}
			return;
		}

		if (event.altKey && (event.code === 'KeyH' || event.key.toLowerCase() === 'h')) {
			event.preventDefault();
			openHelp();
			return;
		}

		if (event.altKey) return;
		if (event.key === 'Backspace') {
			handleBackspace(event);
			return;
		}
		if (event.key.length !== 1) return;

		event.preventDefault();
		const inputPosition = position;
		const expectedCharacter = text[inputPosition];
		if (event.key !== expectedCharacter) {
			incorrectPositions.add(inputPosition);
			error = { expected: expectedCharacter, actual: event.key };
		} else {
			error = null;
		}
		helpMessage = null;
		const positionAfterInput = position + 1;
		position += 1;
		skipParagraphBoundaries();
		if (position >= text.length) {
			if (error === null) {
				completedAt = new Date().toISOString();
				completed = true;
				saveSectionProgress(localStorage, source.id, section, position, completedAt, completedAt);
			}
		} else {
			if (expectedCharacter === ' ' || position > positionAfterInput) {
				saveSectionProgress(localStorage, source.id, section, position, new Date().toISOString());
			}
			keepCurrentPositionVisible();
		}
	}

	function restart() {
		if (source) clearSectionProgress(localStorage, source.id, section.id);
		position = 0;
		error = null;
		incorrectPositions.clear();
		completed = false;
		completedAt = null;
		activeHelp = null;
		helpMessage = null;
		focusTypingStage();
	}
</script>

<svelte:head>
	<title>{section.title} · {source.title} | Typing Practice</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#if !hydrated}
	<main class="session-loading" aria-live="polite">
		<p>Loading Reading Progress...</p>
	</main>
{:else if completed}
	<main class="completion-view" aria-live="polite">
		<p class="eyebrow">Reading complete</p>
		<h1>{source.title}</h1>
		<p>Completed <time datetime={completedAt ?? undefined}>{completionDate}</time></p>
		<div class="completion-actions">
			<a class="secondary-action" href={resolve('/sources/[sourceId]', { sourceId: source.id })}
				>View sections</a
			>
			{#if data.nextSection}
				<a
					class="primary-action"
					href={resolve('/sources/[sourceId]/sections/[sectionId]', {
						sourceId: source.id,
						sectionId: data.nextSection.id
					})}>Next section</a
				>
			{/if}
			<button class="primary-action" type="button" onclick={restart}>Read again</button>
		</div>
	</main>
{:else}
	<main class="session-page">
		<header class="session-header">
			<a
				class="catalog-link"
				href={resolve('/sources/[sourceId]', { sourceId: source.id })}
				aria-label="View sections"
			>
				<span aria-hidden="true">←</span> Sections
			</a>
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
			<div class="session-instructions">
				<p class="keyboard-hint">
					<span class="status-dot" aria-hidden="true"></span>Ready to type
				</p>
				<p class="shortcut-hint"><kbd>Alt</kbd><span>+</span><kbd>H</kbd> for word help</p>
			</div>
			<div class="text-viewport">
				<div class="reading-rail" aria-hidden="true">
					<span style:height={`${progress}%`}></span>
				</div>
				<div class="source-text" aria-label="Reading Source text">
					{#each Array.from(text) as character, index (index)}
						{#if character === '\n'}
							<br aria-hidden="true" />
						{:else}
							<span
								class:completed-character={index < position}
								class:incorrect-character={incorrectPositions.has(index)}
								class:current-character={index === position}>{character}</span
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
					? `Expected ${JSON.stringify(error.expected)}, received ${JSON.stringify(error.actual)}.`
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
