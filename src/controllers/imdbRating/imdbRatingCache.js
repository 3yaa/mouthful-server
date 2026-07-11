import { fetchBuffer, decompress, TTL } from "./imdbCacheUtils.js";

let memCache = null;
let loadingPromise = null;

async function buildMap(force) {
	const buffer = await fetchBuffer(
		"https://datasets.imdbws.com/title.ratings.tsv.gz",
		"mouthful_ratings.tsv.gz",
		force,
	);
	const decompressed = await decompress(buffer);
	// hash
	const map = new Map();
	const lines = decompressed.toString("utf-8").split("\n");
	const yield_ = () => new Promise((r) => setImmediate(r));
	for (let i = 1; i < lines.length; i++) {
		const [tconst, avg, votes] = lines[i].split("\t");
		if (tconst)
			map.set(tconst, {
				rating: parseFloat(avg),
				votes: parseInt(votes),
			});
		// in case need something else to run in the middle
		if (i % 100_000 === 0) await yield_();
	}
	return map;
}

async function loadRatings() {
	// return cache
	if (memCache && Date.now() - memCache.ts < TTL) return memCache.data;
	// another call during caching
	if (loadingPromise) return loadingPromise;

	// cache
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

export async function refreshRatings() {
	const map = await buildMap(true);
	memCache = { data: map, ts: Date.now() };
}

export async function getImdbRatings(imdbIds) {
	const ratings = await loadRatings();
	const result = {};
	for (const id of imdbIds) {
		const entry = ratings.get(id);
		if (entry) result[id] = entry;
	}
	return result;
}
