import dotenv from "dotenv";
import { getImdbRatings } from "../imdbRating/imdbRatingCache.js";
import { fetchJson } from "../utils/httpFetch.js";
import { imdbIdFor, rememberImdbId } from "../utils/imdbIdMap.js";
import { DESI, originsExcept } from "../utils/tmdbOrigins.js";
import {
	droppedRow,
	tmdbPageSlice,
	tmdbRatedSlice,
	warmRatedPool,
} from "../utils/tmdbPages.js";
import { ttlMemo } from "../utils/ttlMemo.js";

dotenv.config();

const TMDB = "https://api.themoviedb.org/3";
const PER_PAGE = 24;
// a movie's runtime and genres barely move
const DETAILS_TTL = 24 * 60 * 60 * 1000;

async function buildMonthUrl(year, month, origin) {
	const pad = (n) => String(n).padStart(2, "0");
	const lastDay = new Date(year, month, 0).getDate();
	const origins =
		origin === "desi"
			? `&with_origin_country=${DESI.join("|")}`
			: origin === "rest"
				? await originsExcept(DESI)
				: "";
	return `${TMDB}/discover/movie?api_key=${process.env.TMDB_API_KEY}&include_adult=false${origins}&primary_release_date.gte=${year}-${pad(month)}-01&primary_release_date.lte=${year}-${pad(month)}-${lastDay}&sort_by=popularity.desc`;
}

const cachedDetails = ttlMemo(
	async (id) => {
		const d = await fetchJson(
			`${TMDB}/movie/${id}?api_key=${process.env.TMDB_API_KEY}`,
		);
		rememberImdbId("movie", id, d.imdb_id || null);
		return {
			imdbId: d.imdb_id || null,
			originCountry: d.origin_country ?? [],
			runtime: d.runtime || null,
			genres: (d.genres ?? []).map((g) => g.name),
		};
	},
	DETAILS_TTL,
	5000,
);

const movieDetails = (id) => cachedDetails(id).catch(() => null);
const imdbIdOf = (id) =>
	imdbIdFor("movie", id, (tmdbId) =>
		cachedDetails(tmdbId).then((d) => d.imdbId),
	);

export async function useTmdbMovieDiscoverAPI(req, res) {
	try {
		const { year, month, page, origin, sort } = req.validated;
		const url = await buildMonthUrl(year, month, origin);
		const {
			results: rawMovies,
			totalPages,
			dropped,
		} = sort === "rated"
			? await tmdbRatedSlice([url], page, PER_PAGE, imdbIdOf)
			: await tmdbPageSlice(url, page, PER_PAGE);
		if (sort !== "rated" && page === 1) warmRatedPool([url], imdbIdOf);

		const details = await Promise.all(
			rawMovies.map((m) => movieDetails(m.id)),
		);
		// a rated page already knows each card's id
		const idOf = (m, i) => details[i]?.imdbId ?? m.imdbId;
		const imdbIds = rawMovies.map(idOf).filter(Boolean);
		const ratings = imdbIds.length ? await getImdbRatings(imdbIds) : {};

		const movies = rawMovies.map((m, i) => {
			const d = details[i];
			const imdbId = idOf(m, i) ?? null;
			return {
				tmdbId: String(m.id),
				imdbId: d || m.imdbId ? imdbId : undefined,
				title: m.title,
				poster_url: m.poster_path
					? `https://image.tmdb.org/t/p/w500${m.poster_path}`
					: null,
				release_date: m.release_date || null,
				originCountry: d?.originCountry ?? [],
				runtime: d?.runtime ?? null,
				genres: d?.genres ?? [],
				imdbRating: imdbId ? (ratings[imdbId]?.rating ?? null) : null,
			};
		});

		res.status(200).json({
			success: true,
			movies,
			totalPages,
			...(dropped && { dropped: dropped.map(droppedRow) }),
		});
	} catch (error) {
		console.error("TMDB movie discover fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch movies from TMDB discover",
			error: error.message,
		});
	}
}
