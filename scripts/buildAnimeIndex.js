// Builds the offline anime index the show pipeline reads at request time.
//
// Two upstream datasets, joined on the AniList id:
//   Fribb/anime-lists      tmdb tv id -> (anilist id, season, episode offset)
//   manami anime-offline-database  anilist id -> title, episodes, status, art
//
// Both are downloaded in full (~70MB), projected down to the handful of fields
// the pipeline actually reads, and written out as a ~5MB file. Parsing the raw
// database costs 115MB of heap; the projection costs 13MB, which is why this
// runs here and not at boot.
//
//   node scripts/buildAnimeIndex.js
//
// Re-run weekly. Fribb publishes every Monday; manami's cadence is irregular
// (weekly for stretches, then multi-week gaps), so a stale pin is normal and
// the request path is built to tolerate it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/data/anime-index.json");

const FRIBB_URL =
	"https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const MODB_RELEASES =
	"https://api.github.com/repos/manami-project/anime-offline-database/releases?per_page=30";
const modbAsset = (tag) =>
	`https://github.com/manami-project/anime-offline-database/releases/download/${tag}/anime-offline-database-minified.json`;

// AOD marks compilation films with a tag rather than a relation type, which is
// the whole reason recap detection can happen offline.
const RECAP_TAGS = new Set(["recap", "compilation", "summary"]);

const anilistIdFrom = (url) => {
	const m = /anilist\.co\/anime\/(\d+)/.exec(url);
	return m ? Number(m[1]) : null;
};

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

// MAL serves the plain path at 225x318, which is a thumbnail. The "l" variant
// of the same asset is 425x600 and is what makes AOD usable as a poster source
// rather than just a fallback swatch.
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

	// --- anilist id -> metadata -------------------------------------------
	// Only entries carrying an AniList source can be joined to anything else,
	// which is roughly half the database.
	const aod = {};
	let aodCount = 0;
	for (const entry of modb.data) {
		const id = entry.sources.map(anilistIdFrom).find(Boolean);
		if (!id) continue;
		const tags = entry.tags ?? [];
		aod[id] = {
			t: entry.title,
			k: entry.type,
			e: entry.episodes ?? null,
			s: entry.status,
			y: entry.animeSeason?.year ?? null,
			q: entry.animeSeason?.season ?? null,
			p: upsizePicture(entry.picture),
			d: toMinutes(entry.duration),
			c: entry.score?.arithmeticGeometricMean ?? null,
			// relatedAnime is 99.4% reciprocal, so a plain BFS needs no reverse
			// edge table. It is untyped, which is why it supplements the tmdb
			// mapping rather than replacing it.
			r: [...new Set(entry.relatedAnime.map(anilistIdFrom).filter(Boolean))],
			...(tags.some((tag) => RECAP_TAGS.has(tag)) ? { x: 1 } : {}),
		};
		aodCount++;
	}

	// --- tmdb tv id -> ordered rows, and anilist id -> tmdb ids ------------
	const tv = {};
	const al = {};
	let tvRows = 0;
	for (const row of fribb) {
		const ids = row.themoviedb_id;
		if (row.anilist_id != null && ids) {
			const movie = Array.isArray(ids.movie) ? ids.movie[0] : ids.movie;
			const show = Array.isArray(ids.tv) ? ids.tv[0] : ids.tv;
			if (movie != null || show != null) {
				al[row.anilist_id] = {
					...(show != null ? { tv: show } : {}),
					...(movie != null ? { mv: movie } : {}),
				};
			}
		}

		if (ids?.tv == null) continue;
		for (const id of Array.isArray(ids.tv) ? ids.tv : [ids.tv]) {
			(tv[id] ??= []).push({
				al: row.anilist_id ?? null,
				ad: row.anidb_id ?? null,
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

	const payload = {
		builtAt: new Date().toISOString(),
		modbRelease: release.tag_name,
		modbPublished: release.published_at,
		aod,
		tv,
		al,
	};

	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	fs.writeFileSync(OUT, JSON.stringify(payload));

	const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
	console.log(
		`\n  ${aodCount} anime, ${Object.keys(tv).length} tmdb shows (${tvRows} rows), ${Object.keys(al).length} reverse ids`,
	);
	console.log(`  wrote ${path.relative(process.cwd(), OUT)} (${mb}MB)`);
}

main().catch((error) => {
	console.error("anime index build failed:", error.message);
	process.exit(1);
});
