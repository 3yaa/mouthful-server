import { fetchBuffer, decompress, TTL } from "./imdbCacheUtils.js";

let memCache = null;
let loadingPromise = null;

async function buildMap(force) {
	const buffer = await fetchBuffer(
		"https://datasets.imdbws.com/title.episode.tsv.gz",
		"mouthful_episodes.tsv.gz",
		force,
	);
	const decompressed = await decompress(buffer);
	// hash
	const map = new Map();
	const lines = decompressed.toString("utf-8").split("\n");
	const yield_ = () => new Promise((r) => setImmediate(r));
	for (let i = 1; i < lines.length; i++) {
		const [tconst, parentTconst, seasonRaw, episodeRaw] =
			lines[i].split("\t");
		if (!tconst || !parentTconst) continue;
		const season = parseInt(seasonRaw);
		const episode = parseInt(episodeRaw);
		if (isNaN(season) || isNaN(episode)) continue;
		if (!map.has(parentTconst)) map.set(parentTconst, []);
		map.get(parentTconst).push({ tconst, season, episode });
		// in case need something else to run in the middle
		if (i % 100_000 === 0) await yield_();
	}
	return map;
}

async function loadEpisodes() {
	if (memCache && Date.now() - memCache.ts < TTL) return memCache.data;
	if (loadingPromise) return loadingPromise;

	loadingPromise = (async () => {
		try {
			const map = await buildMap(false);
			memCache = { data: map, ts: Date.now() };
			return map;
		} finally {
			loadingPromise = null;
		}
	})();
	return loadingPromise;
}

export async function refreshEpisodes() {
	const map = await buildMap(true);
	memCache = { data: map, ts: Date.now() };
}

export async function getShowEpisodes(parentImdbId) {
	const map = await loadEpisodes();
	return map.get(parentImdbId) ?? [];
}
