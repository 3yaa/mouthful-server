import dotenv from "dotenv";
import { httpFetch } from "./httpFetch.js";
import { anilistRequest } from "../shows/anime/externalCalls/anilistClient.js";

dotenv.config();

const TMDB_BASE = "https://api.themoviedb.org/3";
const DAY = 24 * 60 * 60 * 1000;
// re-upload
const LATE_GRACE = 60 * DAY;
// how early a later season's trailer goes up
const SEASON_LEAD = 270 * DAY;
// misses retry sooner
const FOUND_TTL = 7 * DAY;
const MISS_TTL = DAY / 2;
const CACHE_MAX = 1000;
// dead uploads skipped before giving up
const MAX_PROBES = 3;
const PROBE_MS = 4000;

const RERELEASE =
	/re-?release|anniversary|\b4k\b|restor|remaster|imax|blu-?ray|dvd|digital|home ent/i;
const SEASON_NAMED = /\b(?:season|series)\s*(\d+)|\bS(\d+)\b/gi;
// tmdb types some of these as trailers
const NOT_FULL = /teaser|\bspot\b|sneak peek/i;

const WATCH = {
	youtube: (id) => `https://www.youtube.com/watch?v=${id}`,
	dailymotion: (id) => `https://www.dailymotion.com/video/${id}`,
};

// --- cache

const cache = new Map();
const inflight = new Map();

async function remember(key, find) {
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.url;

	let call = inflight.get(key);
	if (!call) {
		call = find().finally(() => inflight.delete(key));
		inflight.set(key, call);
	}
	const url = await call;
	cache.delete(key);
	cache.set(key, { url, expires: Date.now() + (url ? FOUND_TTL : MISS_TTL) });
	if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
	return url;
}

// --- liveness

// a removed upload answers 400/404 -- embed-blocked ones answer 401 but still play
async function isGone({ site, key }) {
	if (site !== "youtube") return false;
	try {
		const res = await httpFetch(
			`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(WATCH.youtube(key))}`,
			{},
			PROBE_MS,
		);
		res.body?.cancel();
		return res.status === 400 || res.status === 404;
	} catch {
		return false;
	}
}

async function firstLive(videos) {
	const seen = new Set();
	const unique = videos.filter((v) => !seen.has(v.key) && seen.add(v.key));
	for (const video of unique.slice(0, MAX_PROBES)) {
		if (!(await isGone(video))) return WATCH[video.site](video.key);
	}
	return null;
}

// --- tmdb

async function tmdbFetch(path, params = {}) {
	const query = new URLSearchParams({
		api_key: process.env.TMDB_API_KEY,
		include_video_language: "en,null",
		...params,
	});
	const response = await httpFetch(`${TMDB_BASE}${path}?${query}`);
	if (!response.ok) {
		const error = new Error(`TMDB API error: ${response.statusText}`);
		error.status = response.status;
		throw error;
	}
	return response.json();
}

const timeOf = (date) => {
	const time = Date.parse(date ?? "");
	return Number.isNaN(time) ? null : time;
};

// lexicographic, true first
const byFlags = (a, b) => {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return a[i] ? -1 : 1;
	}
	return 0;
};

// youtube trailers and teasers
function trailersOf(videos, releaseDate) {
	const release = timeOf(releaseDate);
	return (videos ?? [])
		.filter(
			(v) =>
				v.site === "YouTube" &&
				v.key &&
				(v.type === "Trailer" || v.type === "Teaser"),
		)
		.map((v) => {
			const at = timeOf(v.published_at) ?? 0;
			return {
				site: "youtube",
				key: v.key.trim(),
				name: v.name ?? "",
				at,
				// later uploads are re-cuts, spots and recaps
				early: release == null || at <= release + LATE_GRACE,
				isTrailer: v.type === "Trailer" && !NOT_FULL.test(v.name ?? ""),
				official: !!v.official,
				english: v.iso_639_1 === "en",
				seasonal: false,
			};
		});
}

// the campaign's first full trailer leads
const rank = (trailers) =>
	trailers
		.map((t) => ({
			...t,
			flags: [
				!RERELEASE.test(t.name),
				t.english,
				t.early,
				t.seasonal,
				t.isTrailer,
				t.official,
			],
		}))
		.sort((a, b) => byFlags(a.flags, b.flags) || a.at - b.at);

const seasonsNamed = (name) =>
	[...name.matchAll(SEASON_NAMED)].map((m) => Number(m[1] ?? m[2]));

// a show-wide trailer counts for a season when it names it or went up just before it
function forSeason(trailers, season, airDate) {
	const air = timeOf(airDate);
	return trailers.flatMap((t) => {
		const seasons = seasonsNamed(t.name);
		// the show's launch campaign is the first season's
		if (seasons.includes(season) || (season === 1 && !seasons.length))
			return [{ ...t, seasonal: true }];
		if (seasons.length) return [];
		const near =
			air != null &&
			t.at >= air - SEASON_LEAD &&
			t.at <= air + LATE_GRACE;
		return near ? [t] : [];
	});
}

async function findMovieTrailer(tmdbId) {
	const movie = await tmdbFetch(`/movie/${tmdbId}`, {
		append_to_response: "videos",
	});
	return firstLive(
		rank(trailersOf(movie.videos?.results, movie.release_date)),
	);
}

// the season's own list ranks alongside the show's
async function findShowTrailer(tmdbId, season) {
	const [show, own] = await Promise.all([
		tmdbFetch(`/tv/${tmdbId}`, { append_to_response: "videos" }),
		season != null
			? tmdbFetch(`/tv/${tmdbId}/season/${season}/videos`).catch(
					() => null,
				)
			: null,
	]);
	const airDate =
		season != null
			? show.seasons?.find((s) => s.season_number === season)?.air_date
			: show.first_air_date;
	const wide = trailersOf(show.videos?.results, airDate);
	if (season == null) return firstLive(rank(wide));
	return firstLive(
		rank([
			...trailersOf(own?.results, airDate).map((t) => ({
				...t,
				seasonal: true,
			})),
			...forSeason(wide, season, airDate),
		]),
	);
}

// --- anilist

const ANIME_TRAILER = `
  query AnimeTrailer($id: Int) {
    Media(id: $id, type: ANIME) {
      trailer { id site }
    }
  }
`;

async function findAnimeTrailer(anilistId) {
	const data = await anilistRequest(
		ANIME_TRAILER,
		{ id: anilistId },
		{ cacheKey: "trailer" },
	).catch((e) => {
		if (e.status === 404) return null;
		throw e;
	});
	const { id, site } = data?.Media?.trailer ?? {};
	// some ids come with stray whitespace
	const key = id?.trim();
	return key && WATCH[site] ? firstLive([{ site, key }]) : null;
}

// --- handlers

export async function useMovieTrailerAPI(req, res) {
	try {
		const { tmdbId } = req.query;
		const url = await remember(`movie:${tmdbId}`, () =>
			findMovieTrailer(tmdbId),
		);
		res.status(200).json({ success: true, url });
	} catch (e) {
		console.error("Failed to fetch movie trailer: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch movie trailer",
			error: e.message,
		});
	}
}

// an anime node by its anilist id, any other show by season
export async function useShowTrailerAPI(req, res) {
	try {
		const { anilistId, tmdbId, season } = req.validated;
		const url = anilistId
			? await remember(`anime:${anilistId}`, () =>
					findAnimeTrailer(anilistId),
				)
			: await remember(`show:${tmdbId}:${season ?? ""}`, () =>
					findShowTrailer(tmdbId, season),
				);
		res.status(200).json({ success: true, url });
	} catch (e) {
		console.error("Failed to fetch show trailer: ", e);
		res.status(500).json({
			success: false,
			message: "Failed to fetch show trailer",
			error: e.message,
		});
	}
}
