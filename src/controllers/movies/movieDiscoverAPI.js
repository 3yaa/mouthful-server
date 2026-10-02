import dotenv from "dotenv";
import { getImdbRatings } from "../imdbRating/imdbRatingCache.js";
import { httpFetch } from "../utils/httpFetch.js";
import { tmdbPageSlice } from "../utils/tmdbPages.js";

dotenv.config();

const TMDB = "https://api.themoviedb.org/3";
const PER_PAGE = 24;

function buildMonthUrl(year, month) {
	const pad = (n) => String(n).padStart(2, "0");
	const lastDay = new Date(year, month, 0).getDate();
	return `${TMDB}/discover/movie?api_key=${process.env.TMDB_API_KEY}&include_adult=false&primary_release_date.gte=${year}-${pad(month)}-01&primary_release_date.lte=${year}-${pad(month)}-${lastDay}&sort_by=popularity.desc`;
}

async function movieDetails(id) {
	try {
		const r = await httpFetch(
			`${TMDB}/movie/${id}?api_key=${process.env.TMDB_API_KEY}`,
		);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return await r.json();
	} catch {
		return null;
	}
}

export async function useTmdbMovieDiscoverAPI(req, res) {
	try {
		const { year, month, page } = req.validated;
		const { results: rawMovies, totalPages } = await tmdbPageSlice(
			buildMonthUrl(year, month),
			page,
			PER_PAGE,
		);

		const details = await Promise.all(
			rawMovies.map((m) => movieDetails(m.id)),
		);
		const imdbIds = details.map((d) => d?.imdb_id).filter(Boolean);
		const ratings = imdbIds.length ? await getImdbRatings(imdbIds) : {};

		const movies = rawMovies.map((m, i) => {
			const d = details[i];
			const imdbId = d?.imdb_id || null;
			return {
				tmdbId: String(m.id),
				imdbId,
				title: m.title,
				poster_url: m.poster_path
					? `https://image.tmdb.org/t/p/w500${m.poster_path}`
					: null,
				release_date: m.release_date || null,
				originCountry: d?.origin_country ?? [],
				runtime: d?.runtime || null,
				genres: (d?.genres ?? []).map((g) => g.name),
				imdbRating: imdbId ? (ratings[imdbId]?.rating ?? null) : null,
			};
		});

		res.status(200).json({ success: true, movies, totalPages });
	} catch (error) {
		console.error("TMDB movie discover fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch movies from TMDB discover",
			error: error.message,
		});
	}
}
