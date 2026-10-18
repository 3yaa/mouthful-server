import { existsSync, readFileSync } from "fs";
import { rename, writeFile } from "fs/promises";

// a found id never changes, a missing one is asked again later
const FILE = "/tmp/mouthful_tmdb_imdb.json";
const DAY = 24 * 60 * 60 * 1000;
const POOL_RECHECK_MS = 7 * DAY;
const LIBRARY_RECHECK_MS = DAY;
const SAVE_AFTER_MS = 10_000;
// tmdb paces a key at ~45 calls a second
const LOOKUPS_PER_SEC = 35;

let ids = null;
let saving = null;
let nextSlot = 0;

function load() {
	if (ids) return ids;
	ids = new Map();
	try {
		if (existsSync(FILE))
			for (const [key, entry] of JSON.parse(readFileSync(FILE, "utf8")))
				ids.set(key, entry);
	} catch (error) {
		console.warn("imdb id map unreadable, starting empty: ", error.message);
	}
	return ids;
}

function saveSoon() {
	saving ??= setTimeout(() => {
		saving = null;
		// a crash mid-write must not cost the whole map
		writeFile(`${FILE}.tmp`, JSON.stringify([...ids]))
			.then(() => rename(`${FILE}.tmp`, FILE))
			.catch((error) =>
				console.warn("imdb id map not saved: ", error.message),
			);
	}, SAVE_AFTER_MS);
}

export function rememberImdbId(kind, tmdbId, imdbId) {
	const key = `${kind}:${tmdbId}`;
	const found = imdbId ?? null;
	const held = load().get(key)?.imdbId;
	// a found id never goes stale or gets lost to a miss -- a miss restarts its recheck clock
	if (held && (!found || found === held)) return;
	load().set(key, { imdbId: found, at: Date.now() });
	saveSoon();
}

function slot() {
	const now = Date.now();
	const at = Math.max(now, nextSlot);
	nextSlot = at + 1000 / LOOKUPS_PER_SEC;
	return new Promise((done) => setTimeout(done, at - now));
}

const asked = new Map();
async function ask(kind, tmdbId, lookup) {
	const key = `${kind}:${tmdbId}`;
	if (!asked.has(key))
		asked.set(
			key,
			slot()
				.then(() => lookup(tmdbId))
				.then((imdbId) => {
					rememberImdbId(kind, tmdbId, imdbId);
					return imdbId ?? null;
				})
				.finally(() => asked.delete(key)),
		);
	return asked.get(key);
}

// a failed lookup answers undefined without being kept -- null is a known miss
export async function imdbIdFor(kind, tmdbId, lookup) {
	const hit = load().get(`${kind}:${tmdbId}`);
	if (hit?.imdbId) return hit.imdbId;
	if (hit) {
		// a stale miss answers now and is asked again behind it
		if (Date.now() - hit.at > POOL_RECHECK_MS)
			ask(kind, tmdbId, lookup).catch(() => {});
		return null;
	}
	return ask(kind, tmdbId, lookup).catch(() => undefined);
}

// never waits
export function peekImdbId(kind, tmdbId, lookup) {
	const hit = load().get(`${kind}:${tmdbId}`);
	if (hit?.imdbId) return hit.imdbId;
	if (!hit || Date.now() - hit.at > LIBRARY_RECHECK_MS)
		ask(kind, tmdbId, lookup).catch(() => {});
	return null;
}
