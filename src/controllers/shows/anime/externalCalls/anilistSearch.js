import { anilistRequest } from "./anilistClient.js";

const SEARCH_QUERY = `
  query FilmSearch($search: String) {
    Page(perPage: 6) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        format
        episodes
        duration
        startDate { year }
        title { romaji english }
      }
    }
  }
`;

// how far off tmdb's year a match may sit -- a film released either side of new year
const YEAR_SLACK = 1;

export async function anilistSearch(title, year) {
	if (!title) return null;
	let media;
	try {
		media = (
			await anilistRequest(
				SEARCH_QUERY,
				{ search: title },
				{ cacheKey: "FilmSearch" },
			)
		)?.Page?.media;
	} catch {
		return null;
	}
	if (!media?.length) return null;

	const closeEnough = (item) =>
		!year ||
		!item.startDate?.year ||
		Math.abs(item.startDate.year - year) <= YEAR_SLACK;

	return (
		media.find((item) => item.format === "MOVIE" && closeEnough(item)) ??
		media.find(closeEnough) ??
		null
	);
}
