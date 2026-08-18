// Loads the offline anime index built by scripts/buildAnimeIndex.js.
//
// Read once on first use and held for the life of the process: ~15MB of heap
// for 20k anime and 4.2k tmdb shows, which buys a zero-network resolve for
// every finished series. A missing file is not fatal -- the pipeline degrades
// to the AniList path it already falls back to for unmapped shows.

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
				`manami ${index.modbRelease} (${age}d old)`,
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

export function aodEntry(anilistId) {
	const idx = load();
	if (!idx || anilistId == null) return null;
	return idx.aod[String(anilistId)] ?? null;
}

// { tv, mv } -- the tmdb ids an AniList entry maps back to. Films resolved
// this way can be handed straight to the existing movie pipeline.
export function tmdbIdsFor(anilistId) {
	const idx = load();
	if (!idx || anilistId == null) return null;
	return idx.al[String(anilistId)] ?? null;
}

// Direct neighbours only. relatedAnime is untyped, so this finds the franchise
// but says nothing about watch order -- callers sort on animeSeason instead.
export function relatedIds(anilistId) {
	return aodEntry(anilistId)?.r ?? [];
}
