import dotenv from "dotenv";
import { getImdbRatings } from "../../imdbRating/imdbRatingCache.js";
import { fetchJson } from "../../utils/httpFetch.js";
import { imdbIdFor, rememberImdbId } from "../../utils/imdbIdMap.js";
import { originFeeds } from "../../utils/tmdbOrigins.js";
import {
	droppedRow,
	tmdbMergedSlice,
	tmdbRatedSlice,
	warmRatedPool,
} from "../../utils/tmdbPages.js";
import { ttlMemo } from "../../utils/ttlMemo.js";

dotenv.config();

const PER_PAGE = 24;
// the air days and current episode move as episodes land
const DETAILS_TTL = 30 * 60 * 1000;

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

const cachedDetails = ttlMemo(async (id) => {
	const d = await fetchJson(
		`https://api.themoviedb.org/3/tv/${id}?api_key=${process.env.TMDB_API_KEY}&append_to_response=external_ids`,
	);
	rememberImdbId("tv", id, d.external_ids?.imdb_id ?? null);
	const days = [
		...new Set(
			[d.last_episode_to_air?.air_date, d.next_episode_to_air?.air_date]
				.filter(Boolean)
				.map(toDay),
		),
	];
	return {
		episodes: d.number_of_episodes ?? null,
		airDay: days.length > 0 ? days.join(" & ") : null,
		currentEp: d.last_episode_to_air?.episode_number ?? null,
		imdbId: d.external_ids?.imdb_id ?? null,
	};
}, DETAILS_TTL);

const showDetails = (id) => cachedDetails(id).catch(() => null);
const imdbIdOf = (id) =>
	imdbIdFor("tv", id, (tmdbId) =>
		cachedDetails(tmdbId).then((d) => d.imdbId),
	);

export async function useTmdbTvDiscoverAPI(req, res) {
	try {
		const { origin, country, page, sort } = req.query;
		const year = parseInt(req.query.year, 10);
		const month = parseInt(req.query.month, 10);
		const months = parseInt(req.query.months, 10) || 1;

		// TO GET TMDBID AND POPULARITY SORT
		const feeds = await originFeeds(origin, country);
		const urls = feeds.map((origins) =>
			buildRangeUrl(year, month, months, origins),
		);
		const at = parseInt(page, 10) || 1;
		const {
			results: rawShows,
			totalPages,
			dropped,
		} = sort === "rated"
			? await tmdbRatedSlice(urls, at, PER_PAGE, imdbIdOf)
			: await tmdbMergedSlice(urls, at, PER_PAGE);
		if (sort !== "rated" && at === 1) warmRatedPool(urls, imdbIdOf);

		// ACTUALLY GET ALL THE DATAFIELDS
		const details = await Promise.all(
			rawShows.map((s) => showDetails(s.id)),
		);

		// GETS THE IMDB RATINGS
		// a rated page already knows each card's id
		const idOf = (s, i) => details[i]?.imdbId ?? s.imdbId;
		const imdbIds = rawShows.map(idOf).filter(Boolean);
		const imdbRes = imdbIds.length ? await getImdbRatings(imdbIds) : {};

		// ASSEMBLE
		const assembled = rawShows.map((s, i) => {
			const d = details[i] ?? {};
			const imdbId = idOf(s, i) ?? null;
			return {
				tmdbId: String(s.id),
				title: s.name,
				poster_url: s.poster_path
					? `https://image.tmdb.org/t/p/w500${s.poster_path}`
					: null,
				first_air_date: s.first_air_date,
				originCountry: s.origin_country ?? [],
				imdbId: imdbId ?? "",
				imdbRating: imdbId ? (imdbRes[imdbId]?.rating ?? null) : null,
				currentEp: d.currentEp ?? null,
				totalEp: d.episodes ?? null,
				airDays: d.airDay ?? null,
			};
		});

		res.status(200).json({
			success: true,
			shows: assembled,
			totalPages,
			...(dropped && { dropped: dropped.map(droppedRow) }),
		});
	} catch (error) {
		console.error("TMDB-TV discover fetch failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch shows from TMDB-TV discover",
			error: error.message,
		});
	}
}
