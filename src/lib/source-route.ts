import { resolve } from '$app/paths';
import type { CatalogSource } from './catalog';

export function startSourcePath(source: CatalogSource): string {
	return source.sections.length === 1
		? resolve('/sources/[sourceId]/sections/[sectionId]', {
				sourceId: source.id,
				sectionId: source.sections[0].id
			})
		: resolve('/sources/[sourceId]', { sourceId: source.id });
}
