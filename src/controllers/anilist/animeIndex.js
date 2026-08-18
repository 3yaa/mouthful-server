// Loads the offline anime index built by scripts/buildAnimeIndex.js.
//
// Read once on first use and held for the life of the process: ~17MB of heap
// for 22k anime and 4.2k tmdb shows, which buys a zero-network resolve for
// every finished series. A missing file is not fatal -- the pipeline degrades
// to the AniList path it already falls back to for unmapped shows.
//
// Entries are addressed by a string key, "a<anilist id>" or "d<anidb id>".
// Anything AniList has never carried -- the newest cour of an airing show, a
// lot of older ovas -- only exists under a "d" key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../data/anime-index.json",
);

let index = null;
let loadFailed = false;

function load() {
	if (index || loadFailed) return index;
	try {
		index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
		const age = Math.round(
			(Date.now() - Date.parse(index.modbPublished)) / 86400000,
		);
		console.log(
			`anime index loaded: ${Object.keys(index.tv).length} tmdb shows, ` +
				`${Object.keys(index.aod).length} anime, manami ${index.modbRelease} (${age}d old)`,
		);
	} catch (error) {
		loadFailed = true;
		console.error(
			`anime index unavailable (${error.code ?? error.message}) -- ` +
				"falling back to AniList. Run: node scripts/buildAnimeIndex.js",
		);
	}
	return index;
}

export function hasAnimeIndex() {
	return !!load();
}

// Rows for a tmdb tv show, pre-sorted by (season, episode offset). Empty when
// the show is one of the ~4.5% the mapping does not cover.
export function tmdbRows(tmdbId) {
	const idx = load();
	if (!idx) return [];
	return idx.tv[String(Number(tmdbId))] ?? [];
}

export function aodEntry(key) {
	const idx = load();
	if (!idx || !key) return null;
	return idx.aod[key] ?? null;
}

// Direct neighbours only, canonicalised to the same key space. relatedAnime is
// untyped, so this finds the franchise but says nothing about watch order --
// callers sort on animeSeason instead.
export function relatedKeys(key) {
	return aodEntry(key)?.r ?? [];
}

// The AniList id behind a key, where there is one. Only these can be refreshed
// live; a "d" entry has no AniList record to ask about.
export function anilistIdOf(key) {
	return key?.[0] === "a" ? Number(key.slice(1)) : null;
}
