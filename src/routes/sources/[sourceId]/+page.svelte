<script lang="ts">
	import {
		emptyProgress,
		readProgress,
		savedSections,
		sourceProgress,
		type ReadingProgress
	} from '$lib/progress';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { data } = $props();
	let progress = $state<ReadingProgress>(emptyProgress());
	const aggregate = $derived(sourceProgress(progress, data.source));

	onMount(() => {
		progress = readProgress(localStorage);
	});

	function status(sectionId: string): string {
		const saved = savedSections(progress, data.source.id)[sectionId];
		return saved?.completedAt ? 'Completed' : saved ? 'In progress' : 'Not started';
	}
</script>

<svelte:head><title>{data.source.title} | Typing Practice</title></svelte:head>

<main class="source-page">
	<nav class="site-nav" aria-label="Main navigation">
		<a class="wordmark" href={resolve('/')}
			><span class="wordmark-mark" aria-hidden="true">T</span><span>Typing Practice</span></a
		>
		<a class="catalog-link" href={resolve('/')}><span aria-hidden="true">←</span> Catalog</a>
	</nav>
	<header class="source-page-header">
		<p class="eyebrow">Reading Source</p>
		<h1>{data.source.title}</h1>
		<p>by {data.source.author}</p>
		<div class="overall-progress" aria-label={`${aggregate.percentage}% overall progress`}>
			<span>{aggregate.completed} of {data.source.sections.length} sections completed</span>
			<div class="card-progress"><span style:width={`${aggregate.percentage}%`}></span></div>
		</div>
	</header>
	<section aria-labelledby="sections-heading">
		<div class="section-heading">
			<h2 id="sections-heading">Sections</h2>
			<span>In source order</span>
		</div>
		<ol class="section-list">
			{#each data.source.sections as section, index (section.id)}
				<li>
					<a
						href={resolve('/sources/[sourceId]/sections/[sectionId]', {
							sourceId: data.source.id,
							sectionId: section.id
						})}
					>
						<span class="section-number">{String(index + 1).padStart(2, '0')}</span>
						<strong>{section.title}</strong>
						<span class:completed-status={status(section.id) === 'Completed'}
							>{status(section.id)}</span
						>
					</a>
				</li>
			{/each}
		</ol>
	</section>
</main>
