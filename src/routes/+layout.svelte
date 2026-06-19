<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#101311" />
</svelte:head>

<div class="desktop-app">{@render children()}</div>
<div class="desktop-required">
	<p>Typing Practice is designed for a desktop keyboard.</p>
</div>
