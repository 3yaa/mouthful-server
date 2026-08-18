// Builds the offline anime index the show pipeline reads at request time.
//
// Three upstream sources, joined into one file:
//   Fribb/anime-lists              tmdb tv id -> (anilist/anidb id, season, offset)
//   manami anime-offline-database  ids -> title, episodes, status, art, relations
//   TMDB /find                     imdb id -> tmdb movie id, for the films
//
// The imdb id itself is never stored: Fribb often carries the parent series'
// id on a film row -- both Hajime no Ippo films claim the show's tt0481256 --
// so it is only ever used as a lookup key here, and discarded if /find comes
// back with a tv result instead of a movie.
//
//   node scripts/buildAnimeIndex.js
//
// Re-run weekly. Fribb publishes every Monday; manami's cadence is irregular
// (weekly for stretches, then multi-week gaps), so a stale pin is normal and
// the request path is built to tolerate it. The imdb->tmdb answers are cached
// in a sidecar so a rebuild only pays for films it has not seen before.
//
// Entries are keyed by "a<anilist id>" where one exists and "d<anidb id>"
// otherwise. Keying on AniList alone lost 249 tmdb rows and 1421 anime that
// AniList has never carried -- always the newest cour and the older ovas,
// which is exactly the material the chain is supposed to show.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(HERE, "../.env") });

const OUT = path.join(HERE, "../src/data/anime-index.json");
const FIND_CACHE = path.join(HERE, "../src/data/.imdb-tmdb-cache.json");

const FRIBB_URL =
	"https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const MODB_RELEASES =
	"https://api.github.com/repos/manami-project/anime-offline-database/releases?per_page=30";
const modbAsset = (tag) =>
	`https://github.com/manami-project/anime-offline-database/releases/download/${tag}/anime-offline-database-minified.json`;

// AOD marks compilation films with a tag rather than a relation type, which is
// the whole reason recap detection can happen offline.
const RECAP_TAGS = new Set(["recap", "compilation", "summary"]);

// Runtime decides what counts as a film. AniList files 7-minute promos as
// MOVIE; the same threshold rescues feature-length entries filed as SPECIAL.
const FEATURE_MINUTES = 45;

const idFrom = (url, host) => {
	const m = new RegExp(`${host}/anime/(\\d+)`).exec(url);
	return m ? Number(m[1]) : null;
};
const anilistId = (url) => idFrom(url, "anilist\\.co");
const anidbId = (url) => idFrom(url, "anidb\\.net");
const onMal = (url) => url.includes("myanimelist.net");

async function getJson(url, label) {
	process.stdout.write(`  fetching ${label} ... `);
	const res = await fetch(url, { headers: { Accept: "application/json" } });
	if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
	const text = await res.text();
	console.log(`${(text.length / 1048576).toFixed(1)}MB`);
	return JSON.parse(text);
}

// The "latest" tag is abandoned upstream -- it still points at a 2025 build.
// Only the ISO-week tags (2026-27) track the real releases.
async function newestModbTag() {
	const releases = await getJson(MODB_RELEASES, "manami release list");
	const weekly = releases
		.filter((r) => /^\d{4}-\d{1,2}$/.test(r.tag_name))
		.sort((a, b) => b.published_at.localeCompare(a.published_at));
	if (!weekly.length) throw new Error("no dated manami release found");
	return weekly[0];
}

// MAL serves the plain path at 225x318 and the "l" variant of the same asset
// at 425x600. Store the large one; the client's image loader steps back down.
function upsizePicture(url) {
	if (!url || !url.includes("cdn.myanimelist.net")) return url ?? null;
	return url.replace(/(\/\d+)\.(jpg|jpeg|png|webp)$/i, "$1l.$2");
}

function toMinutes(duration) {
	if (!duration || typeof duration.value !== "number") return null;
	const seconds =
		duration.unit === "SECONDS"
			? duration.value
			: duration.unit === "MINUTES"
				? duration.value * 60
				: duration.unit === "HOURS"
					? duration.value * 3600
					: null;
	return seconds == null ? null : Math.round(seconds / 60);
}

const isFeature = (entry) => {
	if (!["MOVIE", "SPECIAL", "OVA"].includes(entry.k)) return false;
	if ((entry.e ?? 1) > 1) return false;
	return entry.d == null ? entry.k === "MOVIE" : entry.d >= FEATURE_MINUTES;
};

// TMDB answers /find with the show when an anime's imdb id belongs to the
// parent series rather than to the film -- Attack on Titan's finale, JoJo's
// Phantom Blood and both Ippo films all do this. Taking only movie_results
// means those decline cleanly instead of mapping a film onto a tv row.
async function resolveImdbToMovie(pairs, apiKey) {
	const cache = fs.existsSync(FIND_CACHE)
		? JSON.parse(fs.readFileSync(FIND_CACHE, "utf8"))
		: {};

	const todo = pairs.filter(([, imdb]) => !(imdb in cache));
	console.log(
		`  imdb -> tmdb movie: ${pairs.length} films, ${pairs.length - todo.length} cached, ${todo.length} to fetch`,
	);

	let done = 0;
	const CONCURRENCY = 12;
	const queue = [...todo];
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
			for (let job = queue.pop(); job; job = queue.pop()) {
				const imdb = job[1];
				try {
					const res = await fetch(
						`https://api.themoviedb.org/3/find/${imdb}?api_key=${apiKey}&external_source=imdb_id`,
					);
					if (res.status === 429) {
						queue.push(job);
						await new Promise((r) => setTimeout(r, 2000));
						continue;
					}
					const data = await res.json();
					cache[imdb] = data?.movie_results?.[0]?.id ?? null;
				} catch {
					// leave it unresolved; the next build retries
				}
				if (++done % 100 === 0)
					process.stdout.write(`    ${done}/${todo.length}\r`);
			}
		}),
	);

	fs.writeFileSync(FIND_CACHE, JSON.stringify(cache));
	return cache;
}

async function main() {
	console.log("building anime index");

	const release = await newestModbTag();
	console.log(
		`  manami release ${release.tag_name} (published ${release.published_at.slice(0, 10)})`,
	);

	const [fribb, modb] = await Promise.all([
		getJson(FRIBB_URL, "fribb anime-list-full"),
		getJson(modbAsset(release.tag_name), "anime-offline-database"),
	]);

	// --- pass 1: key every entry, and learn every anidb alias --------------
	const aod = {};
	const keyByAnidb = new Map();
	const rawRelations = new Map();

	for (const entry of modb.data) {
		const al = entry.sources.map(anilistId).find(Boolean);
		const ad = entry.sources.map(anidbId).find(Boolean);
		const key = al ? `a${al}` : ad ? `d${ad}` : null;
		if (!key) continue;
		if (ad) keyByAnidb.set(ad, key);

		const tags = entry.tags ?? [];
		aod[key] = {
			t: entry.title,
			k: entry.type,
			e: entry.episodes ?? null,
			s: entry.status,
			y: entry.animeSeason?.year ?? null,
			q: entry.animeSeason?.season ?? null,
			p: upsizePicture(entry.picture),
			d: toMinutes(entry.duration),
			c: entry.score?.arithmeticGeometricMean ?? null,
			...(tags.some((tag) => RECAP_TAGS.has(tag)) ? { x: 1 } : {}),
			// Carried by MyAnimeList, the broadest of the trackers. AniDB
			// splits material the others treat as one release -- Attack on
			// Titan's ovas as a separate 8-part "OAD", Demon Slayer's
			// theatrical recap screenings one by one -- and none of those
			// splits reach MAL. This is what tells a real release apart from
			// AniDB's finer cut of one that is already in the list.
			...(entry.sources.some(onMal) ? { m: 1 } : {}),
		};
		rawRelations.set(key, entry.relatedAnime ?? []);
	}

	// --- pass 2: relations, canonicalised ----------------------------------
	// relatedAnime is a flat list of provider urls, so the same neighbour can
	// appear as both its anilist and its anidb address. Resolving through the
	// alias table collapses those to one key.
	for (const [key, urls] of rawRelations) {
		const related = new Set();
		for (const url of urls) {
			const al = anilistId(url);
			if (al && aod[`a${al}`]) {
				related.add(`a${al}`);
				continue;
			}
			const ad = anidbId(url);
			const aliased = ad ? keyByAnidb.get(ad) : null;
			if (aliased) related.add(aliased);
		}
		related.delete(key);
		aod[key].r = [...related];
	}

	// --- pass 3: tmdb rows, keyed the same way -----------------------------
	const tv = {};
	const imdbByKey = new Map();
	let tvRows = 0;
	let viaAnidb = 0;

	for (const row of fribb) {
		const key =
			row.anilist_id != null && aod[`a${row.anilist_id}`]
				? `a${row.anilist_id}`
				: row.anidb_id != null
					? (keyByAnidb.get(row.anidb_id) ?? null)
					: null;

		const imdb = Array.isArray(row.imdb_id) ? row.imdb_id[0] : row.imdb_id;
		if (key && imdb) imdbByKey.set(key, imdb);

		// a film's own tmdb id, where the mapping already knows it
		const movie = Array.isArray(row.themoviedb_id?.movie)
			? row.themoviedb_id.movie[0]
			: row.themoviedb_id?.movie;
		if (key && movie != null && aod[key]) aod[key].mv = movie;

		const shows = row.themoviedb_id?.tv;
		if (shows == null) continue;
		if (key && row.anilist_id == null) viaAnidb++;
		for (const id of Array.isArray(shows) ? shows : [shows]) {
			(tv[id] ??= []).push({
				i: key,
				// null on the main row of shows tmdb never split into seasons
				// (One Piece, Naruto, Hunter x Hunter) -- read as season 1.
				s: row.season?.tmdb ?? null,
				o: row.episode_offset?.tmdb ?? null,
				k: row.type ?? null,
			});
			tvRows++;
		}
	}

	// Sorting once here keeps every request-time read in document order. The
	// offset is load-bearing: Re:Zero files all four of its seasons under tmdb
	// season 1, distinguished only by offsets of 0/26/38/50.
	for (const rows of Object.values(tv)) {
		rows.sort((a, b) => (a.s ?? 1) - (b.s ?? 1) || (a.o ?? 0) - (b.o ?? 0));
	}

	// --- pass 4: the films tmdb never linked to their show -----------------
	// Only films reachable from a mapped show are worth resolving; the rest of
	// the database can never surface in a chain.
	const reachable = new Set();
	for (const rows of Object.values(tv)) {
		for (const row of rows) {
			if (!row.i) continue;
			reachable.add(row.i);
			for (const rel of aod[row.i]?.r ?? []) reachable.add(rel);
		}
	}

	const apiKey = process.env.TMDB_API_KEY;
	if (apiKey) {
		const pending = [...reachable]
			.filter((key) => aod[key] && isFeature(aod[key]) && aod[key].mv == null)
			.map((key) => [key, imdbByKey.get(key)])
			.filter(([, imdb]) => !!imdb);

		const found = await resolveImdbToMovie(pending, apiKey);
		let added = 0;
		for (const [key, imdb] of pending) {
			if (found[imdb] != null) {
				aod[key].mv = found[imdb];
				added++;
			}
		}
		console.log(`  recovered ${added} tmdb movie ids from imdb`);
	} else {
		console.log("  TMDB_API_KEY not set -- skipping imdb -> tmdb pass");
	}

	const payload = {
		builtAt: new Date().toISOString(),
		modbRelease: release.tag_name,
		modbPublished: release.published_at,
		aod,
		tv,
	};

	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	fs.writeFileSync(OUT, JSON.stringify(payload));

	const films = Object.values(aod).filter((e) => isFeature(e));
	console.log(
		`\n  ${Object.keys(aod).length} anime (${keyByAnidb.size} anidb-addressable), ` +
			`${Object.keys(tv).length} tmdb shows (${tvRows} rows, ${viaAnidb} rescued via anidb)`,
	);
	console.log(
		`  ${films.length} films, ${films.filter((e) => e.mv != null).length} with a tmdb movie id`,
	);
	console.log(
		`  wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1048576).toFixed(1)}MB)`,
	);
}

main().catch((error) => {
	console.error("anime index build failed:", error.message);
	process.exit(1);
});
