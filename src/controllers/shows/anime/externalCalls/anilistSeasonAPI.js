import { anilistRequest } from "./anilistClient.js";

const SEASON_QUERY = `
  query SeasonWorks(
    $page: Int
    $season: MediaSeason
    $seasonYear: Int
    $formats: [MediaFormat]
    $status: MediaStatus
    $startAfter: FuzzyDateInt
    $startBefore: FuzzyDateInt
    $endAfter: FuzzyDateInt
  ) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(
        type: ANIME
        isAdult: false
        sort: POPULARITY_DESC
        season: $season
        seasonYear: $seasonYear
        format_in: $formats
        status: $status
        startDate_greater: $startAfter
        startDate_lesser: $startBefore
        endDate_greater: $endAfter
      ) {
        id
        format
        status
        episodes
        duration
        popularity
        averageScore
        genres
        source(version: 3)

        title { romaji english native }
        startDate { year month day }
        coverImage { extraLarge large color }
        studios(isMain: true) { nodes { name } }
        nextAiringEpisode { episode airingAt }
        relations { edges { relationType node { id type } } }
      }
    }
  }
`;

const MAX_PAGES = 6;
export async function fetchSeasonWorks(filter, ttl) {
	const media = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const data = await anilistRequest(
			SEASON_QUERY,
			{ ...filter, page },
			{ cacheKey: "SeasonWorks", ttl },
		);
		media.push(...(data?.Page?.media ?? []));
		if (!data?.Page?.pageInfo?.hasNextPage) break;
	}
	return media;
}
