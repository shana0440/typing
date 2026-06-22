import { error } from '@sveltejs/kit';
import { catalog, findSource } from '$lib/catalog';
import type { EntryGenerator } from './$types';

export const entries: EntryGenerator = () => catalog.map(({ id }) => ({ sourceId: id }));

export function load({ params }) {
	const source = findSource(params.sourceId);
	if (!source) error(404, 'Reading Source not found');
	return { source };
}
