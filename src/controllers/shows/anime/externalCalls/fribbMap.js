import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { httpFetch } from "../../../utils/httpFetch.js";

const SOURCE =
	"https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const DISK_CACHE = join(tmpdir(), "mouthful_fribb_anime_list.json");
const TTL = 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

let memCache = null;
let loadingPromise = null;
let refreshing = false;

const diskAgeMs = () =>
	existsSync(DISK_CACHE)
		? Date.now() - statSync(DISK_CACHE).mtimeMs
		: Infinity;

async function download() {
	const res = await httpFetch(SOURCE, {}, DOWNLOAD_TIMEOUT_MS);
	if (!res.ok) throw new Error(`Fribb list HTTP ${res.status}`);
	const text = await res.text();
	writeFileSync(DISK_CACHE, text);
	return text;
}

// build lookup table
function buildIndexRows(text) {
	let rows = JSON.parse(text);
	//
	const byMal = new Map();
	const byAnilist = new Map();
	const byTmdb = new Map();
	//
	for (const row of rows) {
		const malId = row.mal_id ?? null;
		const anilistId = row.anilist_id ?? null;
		// drop if id is missing
		if (malId === null && anilistId === null) continue;

		// themoviedb_id = {}
		const tmdb = row.themoviedb_id ?? {};
		const isTv = typeof tmdb.tv === "number";
		const tmdbType = isTv
			? "tv"
			: tmdb.movie !== undefined
				? "movie"
				: null;
		// build tmdb ids
		const tmdbIds = isTv
			? [tmdb.tv]
			: Array.isArray(tmdb.movie)
				? tmdb.movie
				: tmdb.movie !== undefined
					? [tmdb.movie]
					: [];

		const slim = {
			malId,
			anilistId,
			tmdbId: tmdbIds[0] ?? null,
			tmdbType,
			// season is { tvdb, tmdb }
			season: row.season?.tmdb ?? null,
			type: row.type ?? null,
		};

		// set the map with trimmed info
		byMal.set(malId, slim);
		byAnilist.set(anilistId, slim);
		// one TMDB series covers a whole run of AniList entries
		for (const id of tmdbIds) {
			const key = `${tmdbType}:${id}`;
			const bucket = byTmdb.get(key);
			if (bucket) bucket.push(slim);
			else byTmdb.set(key, [slim]);
		}
	}

	// sort by season number
	for (const bucket of byTmdb.values()) {
		bucket.sort((a, z) => (a.season ?? Infinity) - (z.season ?? Infinity));
	}

	// null memory
	rows = null;
	return { byMal, byAnilist, byTmdb };
}

// replace the index behind whoever is being served
function revalidate() {
	if (refreshing) return;
	refreshing = true;
	download()
		.then((text) => {
			memCache = { data: buildIndexRows(text), ts: Date.now() };
		})
		.catch((error) =>
			console.error("Fribb map refresh failed: ", error.message),
		)
		.finally(() => {
			refreshing = false;
		});
}

//
async function build() {
	// build from the cache
	if (existsSync(DISK_CACHE)) {
		const stale = diskAgeMs() >= TTL;
		try {
			const data = buildIndexRows(readFileSync(DISK_CACHE, "utf-8"));
			memCache = { data, ts: Date.now() };
			if (stale) revalidate();
			return data;
		} catch (error) {
			// fall through to a fresh download
			console.error("Fribb disk cache unreadable: ", error.message);
		}
	}

	// build from fresh download
	const data = buildIndexRows(await download());
	memCache = { data, ts: Date.now() };
	return data;
}

export async function getFribbMap() {
	// go thru cache
	if (memCache && Date.now() - memCache.ts < TTL) return memCache.data;
	// refresh cache
	if (memCache) {
		revalidate();
		return memCache.data;
	}
	// cold
	loadingPromise ??= build().finally(() => {
		loadingPromise = null;
	});
	return loadingPromise;
}

// forces a download -- manual refresh --- NOT USED
export async function refreshFribbMap() {
	const data = buildIndexRows(await download());
	memCache = { data, ts: Date.now() };
	return data;
}

// every AniList entry sitting under one TMDB id, ordered by season.
export const rowsFor = ({ byTmdb }, tmdbId, type = "tv") =>
	byTmdb.get(`${type}:${Number(tmdbId)}`) ?? [];

export async function findByTmdb(tmdbId, type = "tv") {
	return rowsFor(await getFribbMap(), tmdbId, type);
}
