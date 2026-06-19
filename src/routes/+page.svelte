<script lang="ts">
	import { catalog } from '$lib/catalog';
	import { resolve } from '$app/paths';
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

	<section aria-labelledby="reading-sources">
		<div class="section-heading">
			<h2 id="reading-sources">Reading Sources</h2>
			<span>{catalog.length} source</span>
		</div>

		<div class="source-grid">
			{#each catalog as source (source.id)}
				<article class="source-card">
					<div>
						<p class="source-kind">Short story</p>
						<h3>{source.title}</h3>
						<p class="source-author">by {source.author}</p>
					</div>
					<div class="source-footer">
						<span>{source.sections.length} chapter</span>
						<a class="primary-action" href={resolve('/session')}>Begin reading</a>
					</div>
				</article>
			{/each}
		</div>
	</section>
</main>
