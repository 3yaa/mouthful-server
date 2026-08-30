import { anilistRequest } from "./anilistClient.js";

const STUDIO_QUERY = `
  query StudioWorks($search: String, $page: Int) {
    Studio(search: $search) {
      id
      name
      media(sort: [POPULARITY_DESC], isMain: true, page: $page, perPage: 50) {
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

export async function fetchStudioWorks(name, pages = 3) {
	const search = String(name ?? "").trim();
	if (!search) return null;

	const nodes = [];
	let studio = null;

	for (let page = 1; page <= pages; page++) {
		let data;
		try {
			data = await anilistRequest(
				STUDIO_QUERY,
				{ search, page },
				{ cacheKey: "StudioWorks" },
			);
		} catch (e) {
			if (e.status === 404) return null;
			throw e;
		}
		const found = data?.Studio;
		if (!found) return null;

		studio ??= { id: found.id, name: found.name };
		nodes.push(...(found.media?.nodes ?? []));
		if (!found.media?.pageInfo?.hasNextPage) break;
	}

	return { ...studio, works: nodes };
}
