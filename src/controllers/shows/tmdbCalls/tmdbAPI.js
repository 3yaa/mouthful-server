import { checkDuplicate } from "../../utils/checkDuplicate.js";
import { getLogoUrls } from "../../utils/tmdbLogo.js";
import { getBackdropUrls, getPosterUrls } from "../../utils/tmdbArtwork.js";
import { isAnime, runAnime } from "../anime/utils/isAnimeCheck.js";
import { pickAnimeResult } from "../anime/utils/utilFunctions.js";

const TMDB_BASE = "https://api.themoviedb.org/3";

//
const apiError = (status, message, error, extra = {}) =>
	Object.assign(new Error(message), { status, error, ...extra });

//
const getReleaseYear = (airDate) => {
	const year = parseInt(airDate?.slice(0, 4), 10);
	return Number.isInteger(year) ? year : null;
};

//
export const getCreator = (show) =>
	(show.created_by ?? []).map((c) => c.name).join(", ") || null;

// base call
async function tmdbFetch(path, params = {}) {
	const query = new URLSearchParams({
		api_key: process.env.TMDB_API_KEY,
		...params,
	});
	const response = await fetch(`${TMDB_BASE}${path}?${query}`);
	if (!response.ok) {
		throw apiError(
			response.status,
			`TMDB API error: ${response.statusText || response.status}`,
			`TMDB ${path} failure`,
		);
	}
	return response.json();
}

// --- 1st call -- title | tmdbId {dup check as well }
export async function getTmdbId(title, year, userId, forceAnime) {
	const data = await tmdbFetch(
		"/search/tv",
		year ? { query: title, first_air_date_year: year } : { query: title },
	);
	const results = data.results ?? [];
	// for anime go thru to find main node
	const show =
		(runAnime(forceAnime, isAnime(results[0]))
			? await pickAnimeResult(results)
			: null) ?? results[0];
	if (!show) {
		throw apiError(404, `No show found for "${title}"`, "No show results");
	}
	const showDetect = { title: show.name ?? null, tmdbId: show.id };
	// check duplicate
	if (await checkDuplicate("shows", "tmdb_id", showDetect.tmdbId, userId)) {
		throw apiError(
			409,
			`Show "${showDetect.title}" already in your library`,
			"Duplicate found",
			showDetect,
		);
	}
	return showDetect;
}

// --- 2nd call
export async function getTmdbShowEnrichment(tmdbId) {
	const show = await tmdbFetch(`/tv/${tmdbId}`, {
		append_to_response: "external_ids,images,keywords",
		include_image_language: "en,null",
	});
	// check if valid
	if (!show?.id) {
		throw apiError(404, "Show not found in TMDB Enrich", "No show results");
	}

	// all ranked
	const logos = getLogoUrls(show.images);
	const posters = getPosterUrls(show.images, show.poster_path, "w500");
	const backdrops = getBackdropUrls(show.images, show.backdrop_path);

	const processedShow = {
		released_date: getReleaseYear(show.first_air_date),
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
				episode_count: season.episode_count ?? 0,
				posterUrl: season.poster_path
					? `https://image.tmdb.org/t/p/w500${season.poster_path}`
					: null,
			})),
	};

	return {
		title: show.name ?? null,
		nativeTitle: show.original_name ?? null,
		processedShow,
		wantAnime: isAnime(show),
	};
}
