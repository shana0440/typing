<script lang="ts">
	import { catalog, type CatalogSource } from '$lib/catalog';
	import { startSourcePath } from '$lib/source-route';
	import {
		emptyProgress,
		mostRecentSection,
		readProgress,
		sourceProgress,
		type ReadingProgress
	} from '$lib/progress';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let progress = $state<ReadingProgress>(emptyProgress());

	const mostRecent = $derived.by(
		() =>
			catalog
				.map((source) => ({ source, saved: mostRecentSection(progress, source) }))
				.filter((entry) => entry.saved !== undefined)
				.sort((a, b) => b.saved!.lastActiveAt.localeCompare(a.saved!.lastActiveAt))[0]
	);

	onMount(() => {
		progress = readProgress(localStorage);
	});

	function percentage(source: CatalogSource): number {
		return sourceProgress(progress, source).percentage;
	}

	function sourceKind(source: CatalogSource): string {
		return source.originalUrl ? 'Article' : 'Short story';
	}

	function sourceHref(source: CatalogSource): string {
		return startSourcePath(source);
	}
</script>

<svelte:head>
	<title>Catalog | Typing Practice</title>
	<meta
		name="description"
		content="Choose a complete Reading Source and practice typing while you read."
	/>
</svelte:head>

<main class="catalog-page">
	<nav class="site-nav" aria-label="Main navigation">
		<a class="wordmark" href={resolve('/')} aria-label="Typing Practice home">
			<span class="wordmark-mark" aria-hidden="true">T</span>
			<span>Typing Practice</span>
		</a>
		<span class="local-note">Progress stays on this device</span>
	</nav>

	<header class="catalog-header">
		<div>
			<p class="eyebrow">A reading practice, not a speed test</p>
			<h1>Read with<br /><em>your hands.</em></h1>
		</div>
		<p class="lede">
			Move through complete essays and stories one character at a time. No timers, scores, or
			streaks. Just the text and your attention.
		</p>
	</header>

	{#if mostRecent}
		<section class="continue-card" aria-labelledby="continue-heading">
			<div class="continue-copy">
				<p class="eyebrow">Most recent</p>
				<h2 id="continue-heading">{mostRecent.source.title}</h2>
				<p class="continue-meta">
					{mostRecent.saved?.completedAt
						? 'Completed'
						: `${percentage(mostRecent.source)}% complete`}
				</p>
				<div class="card-progress" aria-hidden="true">
					<span style:width={`${percentage(mostRecent.source)}%`}></span>
				</div>
			</div>
			<a
				class="primary-action"
				href={resolve('/sources/[sourceId]/sections/[sectionId]', {
					sourceId: mostRecent.source.id,
					sectionId: mostRecent.saved!.sectionId
				})}>{mostRecent.saved?.completedAt ? 'View completed' : 'Continue reading'}</a
			>
		</section>
	{/if}

	<section aria-labelledby="reading-sources">
		<div class="section-heading">
			<div>
				<p class="eyebrow">The library</p>
				<h2 id="reading-sources">Catalog</h2>
			</div>
			<span>{catalog.length} {catalog.length === 1 ? 'source' : 'sources'}</span>
		</div>

		<div class="source-grid">
			{#each catalog as source (source.id)}
				{@const saved = mostRecentSection(progress, source)}
				<article class="source-card">
					<div class="source-card-main">
						<div class="source-card-index" aria-hidden="true">
							{String(catalog.indexOf(source) + 1).padStart(2, '0')}
						</div>
						<p class="source-kind">{sourceKind(source)}</p>
						<h3>{source.title}</h3>
						<p class="source-author">by {source.author}</p>
					</div>
					<div class="card-progress" aria-hidden="true">
						<span style:width={`${percentage(source)}%`}></span>
					</div>
					<div class="source-footer">
						<div class="source-details">
							<span
								>{source.sections.length}
								{source.sections.length === 1 ? 'section' : 'sections'}</span
							>
							<span class="source-progress">
								{saved?.completedAt ? 'Completed' : `${percentage(source)}% complete`}
							</span>
						</div>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- startSourcePath resolves the typed route. -->
						<a class="primary-action" href={sourceHref(source)}
							>{saved ? 'View sections' : 'Begin reading'}</a
						>
					</div>
				</article>
			{/each}
		</div>
	</section>
</main>
