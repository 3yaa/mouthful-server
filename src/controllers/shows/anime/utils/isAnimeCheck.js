const TMDB_ANIME_KEYWORD = 210024;
const TMDB_ANIMATION_GENRE = 16;
const ANIME_ORIGINS = ["JP", "CN", "KR", "TW"];

// tv details name the keyword list "results", movie details name it "keywords"
const keywordIds = (tmdbDetail) => {
	const keywords = tmdbDetail?.keywords;
	return (keywords?.results ?? keywords?.keywords ?? []).map((k) => k.id);
};

// genre+origin -- takes a tv or a movie detail
export function isAnime(tmdbDetail) {
	const genres = tmdbDetail?.genres
		? tmdbDetail.genres.map((g) => g.id)
		: (tmdbDetail?.genre_ids ?? []);
	if (keywordIds(tmdbDetail).includes(TMDB_ANIME_KEYWORD)) return true;

	const origins = tmdbDetail?.origin_country ?? [];
	return (
		genres.includes(TMDB_ANIMATION_GENRE) &&
		origins.some((c) => ANIME_ORIGINS.includes(c))
	);
}

// boolean for if anime or not | forceAnime "1"/"0"
export const runAnime = (forceAnime, tmdbDetect) =>
	forceAnime === "1" || (forceAnime !== "0" && Boolean(tmdbDetect));
