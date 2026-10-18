import dotenv from "dotenv";
import { getImdbRatings } from "../../imdbRating/imdbRatingCache.js";
import { httpFetch } from "../../utils/httpFetch.js";
import { originFeeds } from "../../utils/tmdbOrigins.js";
import { tmdbMergedSlice } from "../../utils/tmdbPages.js";

dotenv.config();

// four rows of the six-wide grid
const PER_PAGE = 24;

function buildRangeUrl(year, month, months, origins) {
	const pad = (n) => String(n).padStart(2, "0");
	const end = new Date(year, month - 1 + months, 0);
	const to = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
	return `https://api.themoviedb.org/3/discover/tv?api_key=${process.env.TMDB_API_KEY}${origins}&first_air_date.gte=${year}-${pad(month)}-01&first_air_date.lte=${to}&sort_by=popularity.desc`;
}

const toDay = (date) =>
	new Date(date + "T00:00:00").toLocaleDateString("en-US", {
		weekday: "short",
	});

export async function useTmdbTvDiscoverAPI(req, res) {
	try {
		const { origin, country, page } = req.query;
		const year = parseInt(req.query.year, 10);
		const month = parseInt(req.query.month, 10);
		const months = parseInt(req.query.months, 10) || 1;

		// TO GET TMDBID AND POPULARITY SORT
		const feeds = await originFeeds(origin, country);
		const { results: rawShows, totalPages } = await tmdbMergedSlice(
			feeds.map((origins) => buildRangeUrl(year, month, months, origins)),
			parseInt(page, 10) || 1,
			PER_PAGE,
		);

		// ACTUALLY GET ALL THE DATAFIELDS
		const details = await Promise.all(
			rawShows.map((s) =>
				httpFetch(
					`https://api.themoviedb.org/3/tv/${s.id}?api_key=${process.env.TMDB_API_KEY}&append_to_response=external_ids`,
				)
					.then((r) => r.json())
					.then((d) => {
						const days = [
							...new Set(
								[
									d.last_episode_to_air?.air_date,
									d.next_episode_to_air?.air_date,
								]
									.filter(Boolean)
									.map(toDay),
							),
						];
						return {
							id: s.id,
							episodes: d.number_of_episodes ?? null,
							airDay: days.length > 0 ? days.join(" & ") : null,
							currentEp:
								d.last_episode_to_air?.episode_number ?? null,
							imdbId: d.external_ids?.imdb_id ?? null,
						};
					})
					.catch(() => ({
						id: s.id,
						episodes: null,
						airDay: null,
						currentEp: null,
						imdbId: null,
					})),
			),
		);

		const detailsMap = Object.fromEntries(details.map((d) => [d.id, d]));

		// GETS THE IMDB RATINGS
		const imdbIds = details.map((d) => d.imdbId).filter(Boolean);
		const imdbRes = imdbIds.length ? await getImdbRatings(imdbIds) : {};

		// ASSEMBLE
		const assembled = rawShows.map((s) => {
			const d = detailsMap[s.id];
			return {
				tmdbId: String(s.id),
				title: s.name,
				poster_url: s.poster_path
					? `https://image.tmdb.org/t/p/w500${s.poster_path}`
					: null,
				first_air_date: s.first_air_date,
				originCountry: s.origin_country ?? [],
				imdbId: d.imdbId ?? "",
				imdbRating: d.imdbId
					? (imdbRes[d.imdbId]?.rating ?? null)
					: null,
				currentEp: d.currentEp,
				totalEp: d.episodes,
				airDays: d.airDay,
			};
		});

		res.status(200).json({ success: true, shows: assembled, totalPages });
	} catch (error) {
		console.error("TMDB-TV discover fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch shows from TMDB-TV discover",
			error: error.message,
		});
	}
}
