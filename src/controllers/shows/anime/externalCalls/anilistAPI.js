import { anilistRequest } from "./anilistClient.js";
const ANILIST_QUERY = `
  query FranchiseNodes($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id
        format
        source
        status
        episodes
        duration
        countryOfOrigin

        title { romaji english native }
        startDate { year month day }
        coverImage { extraLarge large color }

        studios {
          edges {
            isMain
            node { id name }
          }
        }

        relations {
          edges {
            relationType
            node {
              id
              type
              format
              title { romaji english native }
            }
          }
        }
      }
    }
  }
`;

export async function fetchAnilist(ids = [], bypassCache = false) {
	const uniqueIds = [
		...new Set(
			[...ids].map(Number).filter((id) => Number.isInteger(id) && id > 0),
		),
	].sort((a, z) => a - z);
	if (uniqueIds.length === 0) return new Map();

	// create at most 50 IDs in one anilist call
	const chunks = [];
	for (let i = 0; i < uniqueIds.length; i += 50) {
		chunks.push(uniqueIds.slice(i, i + 50));
	}

	const responses = await Promise.all(
		chunks.map((ids) =>
			anilistRequest(
				ANILIST_QUERY,
				{ ids },
				{ cacheKey: "FranchiseNodes", bypassCache },
			),
		),
	);

	// map item id to lets payload
	const mediaById = new Map();
	for (const data of responses) {
		for (const media of data?.Page?.media ?? []) {
			mediaById.set(media.id, media);
		}
	}

	return mediaById;
}
