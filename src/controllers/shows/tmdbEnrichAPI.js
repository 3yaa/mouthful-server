import dotenv from "dotenv";
import { getLogoUrls } from "../utils/tmdbLogo.js";
import { getBackdropUrls, getPosterUrls } from "../utils/tmdbArtwork.js";
dotenv.config();

const TMDB_ANIME_KEYWORD = 210024;
const TMDB_ANIMATION_GENRE = 16;
const ANIME_ORIGINS = ["JP", "CN", "KR", "TW"];

// genre+origin
export function isAnime(tmdbDetail) {
	const genres = (tmdbDetail?.genres ?? []).map((g) => g.id);
	const keywords = (tmdbDetail?.keywords?.results ?? []).map((k) => k.id);
	if (keywords.includes(TMDB_ANIME_KEYWORD)) return true;

	const origins = tmdbDetail?.origin_country ?? [];
	return (
		genres.includes(TMDB_ANIMATION_GENRE) &&
		origins.some((c) => ANIME_ORIGINS.includes(c))
	);
}

// get creator of show
const getCreator = (show) =>
	(show.created_by ?? []).map((c) => c.name).join(", ") || null;

//
export async function useTmdbEnrichAPI(tmdbId) {
	const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=external_ids,images,keywords&include_image_language=en,null`;
	const response = await fetch(url);
	if (!response.ok) {
		const error = new Error(
			`TMDB Enrich API error: ${response.statusText}`,
		);
		error.status = response.status;
		throw error;
	}
	// check if valid
	const show = (await response.json()) || {};
	if (Object.keys(show).length === 0) return null;

	// all ranked
	const logos = getLogoUrls(show.images);
	const posters = getPosterUrls(show.images, show.poster_path, "w500");
	const backdrops = getBackdropUrls(show.images, show.backdrop_path);

	const processedShow = {
		released_date: parseInt(show.first_air_date?.slice(0, 4)),
		imdbId: show.external_ids?.imdb_id ?? null,
		creator: getCreator(show),
		logos,
		posters,
		backdrops,
		//
		seasons: (show.seasons ?? [])
			.filter((season) => season.season_number > 0)
			.map((season) => ({
				season_number: season.season_number,
				episode_count: season.episode_count,
				posterUrl: season.poster_path
					? `https://image.tmdb.org/t/p/w500${season.poster_path}`
					: null,
			})),
	};

	return {
		title: show.name,
		originalTitle: show.original_name ?? null,
		processedShow,
		wantAnime: isAnime(show),
	};
}
