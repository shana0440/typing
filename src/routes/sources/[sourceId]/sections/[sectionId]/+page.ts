import { error } from '@sveltejs/kit';
import { catalog, findSection, findSource, loadSection } from '$lib/catalog';
import type { EntryGenerator } from './$types';

export const entries: EntryGenerator = () =>
	catalog.flatMap((source) =>
		source.sections.map((section) => ({ sourceId: source.id, sectionId: section.id }))
	);

export async function load({ params }) {
	const source = findSource(params.sourceId);
	if (!source) error(404, 'Reading Source not found');
	const metadata = findSection(source, params.sectionId);
	if (!metadata) error(404, 'Reading Section not found');
	const section = await loadSection(source.id, metadata.id);
	const index = source.sections.findIndex(({ id }) => id === metadata.id);
	return { source, section, nextSection: source.sections[index + 1] ?? null };
}
