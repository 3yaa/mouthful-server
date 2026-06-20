import { createGunzip } from "zlib";
import { Readable } from "stream";
import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";

const DISK_CACHE = join("/tmp", "mouthful_ratings.tsv.gz");
const TTL = 24 * 60 * 60 * 1000;

let memCache = null;
let loadingPromise = null;

async function fetchBuffer() {
	if (existsSync(DISK_CACHE) && Date.now() - statSync(DISK_CACHE).mtimeMs < TTL) {
		return readFileSync(DISK_CACHE);
	}
	const res = await fetch("https://datasets.imdbws.com/title.ratings.tsv.gz");
	const buffer = Buffer.from(await res.arrayBuffer());
	writeFileSync(DISK_CACHE, buffer);
	return buffer;
}

async function loadRatings() {
	if (memCache && Date.now() - memCache.ts < TTL) return memCache.data;
	if (loadingPromise) return loadingPromise;

	loadingPromise = (async () => {
		const buffer = await fetchBuffer();
		const decompressed = await new Promise((resolve, reject) => {
			const gunzip = createGunzip();
			const chunks = [];
			Readable.from(buffer).pipe(gunzip);
			gunzip.on("data", (c) => chunks.push(c));
			gunzip.on("end", () => resolve(Buffer.concat(chunks)));
			gunzip.on("error", reject);
		});

		const map = new Map();
		const lines = decompressed.toString("utf-8").split("\n");
		const yield_ = () => new Promise((r) => setImmediate(r));
		for (let i = 1; i < lines.length; i++) {
			const [tconst, avg, votes] = lines[i].split("\t");
			if (tconst) map.set(tconst, { rating: parseFloat(avg), votes: parseInt(votes) });
			if (i % 100_000 === 0) await yield_();
		}

		memCache = { data: map, ts: Date.now() };
		loadingPromise = null;
		return map;
	})();

	return loadingPromise;
}

export async function getImdbRatings(ids) {
	const ratings = await loadRatings();
	const result = {};
	for (const id of ids) {
		const entry = ratings.get(id);
		if (entry) result[id] = entry;
	}
	return result;
}
