import { createGunzip } from "zlib";
import { Readable } from "stream";

let cache = null;
const TTL = 24 * 60 * 60 * 1000;

async function loadEpisodes() {
	if (cache && Date.now() - cache.ts < TTL) return cache.data;

	const res = await fetch("https://datasets.imdbws.com/title.episode.tsv.gz");
	const buffer = Buffer.from(await res.arrayBuffer());

	const decompressed = await new Promise((resolve, reject) => {
		const gunzip = createGunzip();
		const chunks = [];
		Readable.from(buffer).pipe(gunzip);
		gunzip.on("data", (c) => chunks.push(c));
		gunzip.on("end", () => resolve(Buffer.concat(chunks)));
		gunzip.on("error", reject);
	});

	// Map<parentTconst, { tconst, season, episode }[]>
	const map = new Map();
	const lines = decompressed.toString("utf-8").split("\n");
	for (let i = 1; i < lines.length; i++) {
		const [tconst, parentTconst, seasonRaw, episodeRaw] = lines[i].split("\t");
		if (!tconst || !parentTconst) continue;
		const season = parseInt(seasonRaw);
		const episode = parseInt(episodeRaw);
		if (isNaN(season) || isNaN(episode)) continue;
		if (!map.has(parentTconst)) map.set(parentTconst, []);
		map.get(parentTconst).push({ tconst, season, episode });
	}

	cache = { data: map, ts: Date.now() };
	return map;
}

export async function getShowEpisodes(parentImdbId) {
	const map = await loadEpisodes();
	return map.get(parentImdbId) ?? [];
}
