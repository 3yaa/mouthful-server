import { anilistRequest } from "./anilistClient.js";

const STUDIO_QUERY = `
  query StudioWorks($search: String, $page: Int, $sort: [MediaSort]) {
    Studio(search: $search) {
      id
      name
      media(sort: $sort, isMain: true, page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes {
          id
          format
          status
          episodes
          duration
          popularity
          averageScore
          isAdult

          title { romaji english native }
          startDate { year month }
          coverImage { extraLarge large color }
        }
      }
    }
  }
`;

export const STUDIO_SORTS = {
	popular: ["POPULARITY_DESC"],
	recent: ["START_DATE_DESC"],
};

// one page at a time
export async function fetchStudioWorks(
	name,
	{ page = 1, sort = "popular" } = {},
) {
	const search = String(name ?? "").trim();
	if (!search) return null;

	const nodes = [];
	const pageIds = new Set();
	let studio = null;
	let hasNextPage = false;

	for (let at = 1; at <= page; at++) {
		let data;
		try {
			data = await anilistRequest(
				STUDIO_QUERY,
				{
					search,
					page: at,
					sort: STUDIO_SORTS[sort] ?? STUDIO_SORTS.popular,
				},
				{ cacheKey: "StudioWorks" },
			);
		} catch (e) {
			if (e.status === 404) return null;
			throw e;
		}
		const found = data?.Studio;
		if (!found) return null;

		studio ??= { id: found.id, name: found.name };
		const onPage = found.media?.nodes ?? [];
		nodes.push(...onPage);
		if (at === page) for (const node of onPage) pageIds.add(node.id);
		hasNextPage = !!found.media?.pageInfo?.hasNextPage;
		if (!hasNextPage) break;
	}

	return { ...studio, nodes, pageIds, hasNextPage };
}
