import dotenv from "dotenv";
import { checkDuplicate } from "../utils/checkDuplicate.js";
import { getLogoUrls } from "../utils/tmdbLogo.js";
import { getBackdropUrls, getPosterUrls } from "../utils/tmdbArtwork.js";
import { getImdbRatings } from "../imdbRating/imdbRatingCache.js";

dotenv.config();

const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdbFetch(path, params = {}) {
	const query = new URLSearchParams({
		api_key: process.env.TMDB_API_KEY,
		...params,
	});
	const response = await fetch(`${TMDB_BASE}${path}?${query}`);
	if (!response.ok) {
		const error = new Error(`TMDB API error: ${response.statusText}`);
		error.status = response.status;
		throw error;
	}
	return response.json();
}

// --- 1st call -- title | tmdbId
async function searchMovie(title, year) {
	const data = await tmdbFetch(
		"/search/movie",
		year ? { query: title, year } : { query: title },
	);
	return data.results?.[0] ?? null;
}

// ---- 2nd call -- director | releae date | poster | backdrop | logo | tmdbID | imdbID | check belongs_to_collection (decides if call 3 is needed)
async function getMovieDetails(tmdbId) {
	return tmdbFetch(`/movie/${tmdbId}`, {
		append_to_response: "credits,external_ids,images",
		include_image_language: "en,null",
	});
}

// ----- 3rd call -- sequel | prequel | place in series | series title
async function getCollection(collectionId) {
	return tmdbFetch(`/collection/${collectionId}`);
}

const getDirector = (credits) =>
	(credits?.crew ?? [])
		.filter((member) => member.job === "Director")
		.map((member) => member.name)
		.join(", ") || null;

const getReleaseYear = (releaseDate) => {
	const year = parseInt(releaseDate?.slice(0, 4));
	return isNaN(year) ? null : year;
};

// a movie belongs to at most one tmdb collection, so this is one object or null
async function resolveSeries(details, tmdbId) {
	const collectionId = details.belongs_to_collection?.id;
	if (!collectionId) return null;
	// make 3rd call and get series info
	try {
		const collection = await getCollection(collectionId);
		//sort
		const parts = [...(collection.parts ?? [])].sort((a, b) =>
			(a.release_date || "9999").localeCompare(b.release_date || "9999"),
		);
		const index = parts.findIndex(
			(part) => String(part.id) === String(tmdbId),
		);
		if (index === -1) return null;
		//
		return {
			// removes collection from all series title
			series_title:
				collection.name?.replace(/\s*Collection$/i, "").trim() || null,
			position: String(index + 1),
			prequel: parts[index - 1]?.title ?? null,
			sequel: parts[index + 1]?.title ?? null,
		};
	} catch (error) {
		console.error("TMDB collection fetch failed: ", error.message);
		return null;
	}
}

// build everything
export async function useMovieTmdbAPI(req, res) {
	try {
		const userId = req.user.id;
		const { title, year, reload } = req.query;
		// reloading a legacy row
		const isReload = reload === "1";

		// first call
		const match = await searchMovie(title, year);
		if (!match) {
			return res.status(404).json({
				success: false,
				message: "Movie not found",
				error: "No movie results",
			});
		}
		const tmdbId = String(match.id);

		// check for dup
		if (
			!isReload &&
			(await checkDuplicate("movies", "tmdb_id", tmdbId, userId))
		) {
			return res.status(409).json({
				success: false,
				title: match.title,
				message: `Movie "${match.title}" already in your library`,
				error: "Duplicate found",
			});
		}

		// second call
		const details = await getMovieDetails(tmdbId);
		const imdbId = details.external_ids?.imdb_id || null;
		if (!imdbId) {
			return res.status(404).json({
				success: false,
				message: `No IMDb id on record for "${match.title}"`,
				error: "Missing imdb id",
			});
		}

		// legacy some rows are missing tmdbId -- 2nd dup check
		if (
			!isReload &&
			(await checkDuplicate("movies", "imdb_id", imdbId, userId))
		) {
			return res.status(409).json({
				success: false,
				title: match.title,
				message: `Movie "${match.title}" already in your library -- via imdbId`,
				error: "Duplicate found",
			});
		}

		// third call
		const series = await resolveSeries(details, tmdbId);

		// get imdb rating
		const ratings = await getImdbRatings([imdbId]);

		// ranked -- logo_urls
		const logos = getLogoUrls(details.images);
		// ranked -- poster/backdrop
		const posters = getPosterUrls(details.images, details.poster_path);
		const backdrops = getBackdropUrls(
			details.images,
			details.backdrop_path,
		);

		res.status(200).json({
			success: true,
			data: {
				imdbId,
				tmdb_id: tmdbId,
				title: details.title || match.title,
				director: getDirector(details.credits),
				released_date: getReleaseYear(details.release_date),
				imdbRating: ratings[imdbId]?.rating ?? null,
				poster_url: posters[0] ?? null,
				backdrop_url: backdrops[0] ?? null,
				posters,
				backdrops,
				logo_url: logos[0] ?? null,
				logos,
				series,
			},
		});
	} catch (error) {
		console.error("TMDB movie meta fetch failed: ", error);
		res.status(error.status ? error.status : 500).json({
			success: false,
			message: "Failed to fetch movie from TMDB",
			error: error.message,
		});
	}
}

// used for reload
export async function useMovieTmdbByIdAPI(req, res) {
	try {
		const tmdbId = req.query.tmdbId;

		const details = await getMovieDetails(tmdbId);
		const imdbId = details.external_ids?.imdb_id || null;
		const series = await resolveSeries(details, tmdbId);
		const ratings = imdbId ? await getImdbRatings([imdbId]) : {};

		// ranked -- logo_url/poster_url/backdrop_ur
		const logos = getLogoUrls(details.images);
		const posters = getPosterUrls(details.images, details.poster_path);
		const backdrops = getBackdropUrls(
			details.images,
			details.backdrop_path,
		);

		res.status(200).json({
			success: true,
			data: {
				imdbId,
				tmdb_id: tmdbId,
				title: details.title,
				director: getDirector(details.credits),
				released_date: getReleaseYear(details.release_date),
				imdbRating: imdbId ? (ratings[imdbId]?.rating ?? null) : null,
				poster_url: posters[0] ?? null,
				backdrop_url: backdrops[0] ?? null,
				posters,
				backdrops,
				logo_url: logos[0] ?? null,
				logos,
				series,
			},
		});
	} catch (error) {
		console.error("TMDB movie by id failed: ", error);
		res.status(error.status ? error.status : 500).json({
			success: false,
			message: "Failed to fetch movie from TMDB",
			error: error.message,
		});
	}
}
