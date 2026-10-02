import { checkDuplicate } from "../../utils/checkDuplicate.js";
import { getLogoUrls } from "../../utils/tmdbLogo.js";
import { getBackdropUrls, getPosterUrls } from "../../utils/tmdbArtwork.js";
import { isAnime, runAnime } from "../anime/utils/isAnimeCheck.js";
import { pickAnimeResult } from "../anime/utils/utilFunctions.js";
import { animeChainRootFor } from "../anime/movieResolve.js";
import { httpFetch } from "../../utils/httpFetch.js";

const TMDB_BASE = "https://api.themoviedb.org/3";

//
const apiError = (status, message, error, extra = {}) =>
	Object.assign(new Error(message), { status, error, ...extra });

//
const getReleaseYear = (airDate) => {
	const year = parseInt(airDate?.slice(0, 4), 10);
	return Number.isInteger(year) ? year : null;
};

const joinNames = (list) => (list ?? []).map((c) => c.name).join(", ");

// use lead production company as fallback
export const getCreator = (show) =>
	joinNames(show.created_by) || show.production_companies?.[0]?.name || null;

// base call
export async function tmdbFetch(path, params = {}) {
	const query = new URLSearchParams({
		api_key: process.env.TMDB_API_KEY,
		...params,
	});
	const response = await httpFetch(`${TMDB_BASE}${path}?${query}`);
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
async function searchTmdbShow(title, year, forceAnime) {
	const data = await tmdbFetch(
		"/search/tv",
		year ? { query: title, first_air_date_year: year } : { query: title },
	);
	const results = data.results ?? [];
	const searchSaysAnime = runAnime(forceAnime, isAnime(results[0]));
	// for anime go thru to find main node
	const show =
		(searchSaysAnime ? await pickAnimeResult(results) : null) ?? results[0];
	return { show, searchSaysAnime };
}

export async function getTmdbId(title, year, userId, forceAnime, knownId) {
	// a known id skips the search
	let { show, searchSaysAnime } = knownId
		? {
				show: { id: Number(knownId), name: title },
				searchSaysAnime: runAnime(forceAnime, false),
			}
		: await searchTmdbShow(title, year, forceAnime);
	// tmdb's tv index dont answer to the title
	if (!show && forceAnime !== "0") {
		show = await animeChainRootFor(title, year);
		// the fallback answers with a chain root
		if (show) searchSaysAnime = true;
	}
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
	return { ...showDetect, searchSaysAnime };
}

const APPEND_CAP = 20;
const BASE_APPENDS = ["external_ids", "images", "keywords"];
const seasonAppends = (numbers) => numbers.map((n) => `season/${n}`);

const mean = (list) =>
	list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : null;

// an appended season's average episode, in minutes
const seasonMinutes = (season) =>
	mean(
		(season?.episodes ?? [])
			.map((episode) => episode.runtime)
			.filter((minutes) => minutes > 0),
	);

// --- 2nd call
export async function getTmdbShowEnrichment(tmdbId, withRuntimes = false) {
	// the numbers are unknown until this answers, so guess 1..17
	const guessed = withRuntimes
		? Array.from(
				{ length: APPEND_CAP - BASE_APPENDS.length },
				(_, i) => i + 1,
			)
		: [];
	const show = await tmdbFetch(`/tv/${tmdbId}`, {
		append_to_response: [...BASE_APPENDS, ...seasonAppends(guessed)].join(
			",",
		),
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

	// season number -> minutes, for the seasons that came back
	const runtimes = new Map(
		guessed
			.filter((n) => show[`season/${n}`])
			.map((n) => [n, seasonMinutes(show[`season/${n}`])]),
	);

	return {
		title: show.name ?? null,
		nativeTitle: show.original_name ?? null,
		processedShow,
		wantAnime: isAnime(show),
		runtimes,
	};
}

// an episode's minutes per season, as duration
export async function addSeasonRuntimes(
	processedShow,
	tmdbId,
	runtimes = new Map(),
) {
	const seasons = processedShow.seasons ?? [];
	if (
		!seasons.length ||
		seasons.some((s) => s.anilistId != null || s.season_number == null)
	)
		return;
	// past the first 17, or numbered oddly -- 20 to a call
	const missing = seasons
		.map((season) => season.season_number)
		.filter((n) => !runtimes.has(n));
	const batches = [];
	for (let i = 0; i < missing.length; i += APPEND_CAP)
		batches.push(missing.slice(i, i + APPEND_CAP));
	await Promise.all(
		batches.map(async (batch) => {
			try {
				const data = await tmdbFetch(`/tv/${tmdbId}`, {
					append_to_response: seasonAppends(batch).join(","),
				});
				for (const n of batch)
					runtimes.set(n, seasonMinutes(data[`season/${n}`]));
			} catch (error) {
				console.error("TMDB season runtime failed: ", error.message);
			}
		}),
	);
	// a season yet to air borrows the show's usual length
	const usual = mean([...runtimes.values()].filter((m) => m != null));
	for (const season of seasons) {
		const minutes = runtimes.get(season.season_number) ?? usual;
		if (minutes) season.duration = Math.round(minutes * 10) / 10;
	}
}
