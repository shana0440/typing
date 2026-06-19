<script lang="ts">
	import { catalog, sourceText, type ReadingSource } from '$lib/catalog';
	import {
		clearSourceProgress,
		emptyProgress,
		progressForSource,
		readProgress,
		type ReadingProgress
	} from '$lib/progress';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let progress = $state<ReadingProgress>(emptyProgress());

	const mostRecent = $derived.by(
		() =>
			catalog
				.map((source) => ({ source, saved: progressForSource(progress, source) }))
				.filter((entry) => entry.saved !== undefined)
				.sort((a, b) => b.saved!.lastActiveAt.localeCompare(a.saved!.lastActiveAt))[0]
	);

	onMount(() => {
		progress = readProgress(localStorage);
	});

	function percentage(source: ReadingSource): number {
		const saved = progressForSource(progress, source);
		return saved ? Math.round((saved.position / sourceText(source).length) * 100) : 0;
	}

	function restart(sourceId: string) {
		clearSourceProgress(localStorage, sourceId);
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
	<header class="catalog-header">
		<p class="eyebrow">Typing Practice</p>
		<h1>Catalog</h1>
		<p class="lede">Read at your own pace. Type each source from beginning to end.</p>
	</header>

	{#if mostRecent}
		<section class="continue-card" aria-labelledby="continue-heading">
			<div>
				<p class="eyebrow">Most recent</p>
				<h2 id="continue-heading">{mostRecent.source.title}</h2>
				<p>
					{mostRecent.saved?.completedAt
						? 'Completed'
						: `${percentage(mostRecent.source)}% complete`}
				</p>
			</div>
			<a class="primary-action" href={resolve('/session')}
				>{mostRecent.saved?.completedAt ? 'View completed' : 'Continue reading'}</a
			>
		</section>
	{/if}

	<section aria-labelledby="reading-sources">
		<div class="section-heading">
			<h2 id="reading-sources">Reading Sources</h2>
			<span>{catalog.length} source</span>
		</div>

		<div class="source-grid">
			{#each catalog as source (source.id)}
				{@const saved = progressForSource(progress, source)}
				<article class="source-card">
					<div>
						<p class="source-kind">Short story</p>
						<h3>{source.title}</h3>
						<p class="source-author">by {source.author}</p>
						<p class="source-progress">
							{saved?.completedAt ? 'Completed' : `${percentage(source)}% complete`}
						</p>
					</div>
					<div class="source-footer">
						<span>{source.sections.length} chapter</span>
						<a
							class="primary-action"
							href={resolve('/session')}
							onclick={() => saved?.completedAt && restart(source.id)}
							>{saved?.completedAt ? 'Read again' : saved ? 'Continue' : 'Begin reading'}</a
						>
					</div>
				</article>
			{/each}
		</div>
	</section>
</main>
