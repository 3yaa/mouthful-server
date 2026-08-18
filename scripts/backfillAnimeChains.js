// Re-runs the anime pipeline over every stored show.
//
// Rows written before the offline index existed still hold whatever the old
// pipeline saved -- usually tmdb's plain season list, which is why Attack on
// Titan reads as four identically-named parts with no films and no extras.
// Nothing repairs those on its own; a row is only rebuilt when someone opens
// it and hits refresh.
//
//   node scripts/backfillAnimeChains.js --dry-run    inspect, change nothing
//   node scripts/backfillAnimeChains.js              write
//   node scripts/backfillAnimeChains.js --force      rebuild even rows that
//                                                    already look current
//
// Chains are resolved once per tmdb id and reused across users. Finished shows
// cost no network at all, so a few hundred rows take seconds.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/config/db.js";
import { buildAnimeChain, isAnime } from "../src/controllers/anilist/animeChain.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(HERE, "../.env") });

const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

async function tmdbShow(tmdbId) {
	const url =
		`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}` +
		`&append_to_response=external_ids,images,keywords&include_image_language=en,null`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`TMDB ${res.status}`);
	return res.json();
}

// A row is current when its parts carry the identity the new pipeline writes.
// Anything older is either tmdb's own seasons or a chain from a build that
// predates uid.
const looksCurrent = (seasons) =>
	Array.isArray(seasons) && seasons.length > 0 && !!seasons[0]?.uid;

async function main() {
	const { rows } = await pool.query(
		`SELECT id, user_id, tmdb_id, title, seasons, cur_season_index, cur_episode, anilist_id
		   FROM shows
		  WHERE tmdb_id IS NOT NULL
		  ORDER BY tmdb_id`,
	);
	console.log(`${rows.length} show rows\n`);

	const chains = new Map();
	let rebuilt = 0;
	let skipped = 0;
	let failed = 0;

	for (const row of rows) {
		if (!FORCE && looksCurrent(row.seasons)) {
			skipped++;
			continue;
		}

		if (!chains.has(row.tmdb_id)) {
			try {
				const detail = await tmdbShow(row.tmdb_id);
				const tmdbSeasons = (detail.seasons ?? [])
					.filter((s) => s.season_number > 0)
					.map((s) => ({
						season_number: s.season_number,
						episode_count: s.episode_count,
						posterUrl: s.poster_path
							? `https://image.tmdb.org/t/p/w500${s.poster_path}`
							: null,
					}));

				// a row that already carries an anilist id was treated as anime
				// once, so keep treating it as one even if detection now says no
				const wanted = row.anilist_id != null || isAnime(detail);
				chains.set(
					row.tmdb_id,
					wanted
						? await buildAnimeChain({
								tmdbId: row.tmdb_id,
								nativeTitle: detail.original_name,
								fallbackTitle: detail.name,
								year:
									parseInt(detail.first_air_date?.slice(0, 4)) ||
									undefined,
								tmdbSeasons,
							})
						: null,
				);
			} catch (error) {
				console.error(`  ✗ ${row.title} (tmdb ${row.tmdb_id}): ${error.message}`);
				chains.set(row.tmdb_id, null);
				failed++;
			}
		}

		const chain = chains.get(row.tmdb_id);
		if (!chain) {
			skipped++;
			continue;
		}

		const { slots, ...meta } = chain;
		// keep the viewer where they were: match the part they were on by
		// identity, and only fall back to clamping when it no longer exists
		const oldSlot = row.seasons?.[row.cur_season_index ?? 0];
		let index = oldSlot?.uid
			? slots.findIndex((s) => s.uid === oldSlot.uid)
			: oldSlot?.anilistId
				? slots.findIndex((s) => s.anilistId === oldSlot.anilistId)
				: -1;
		if (index === -1) index = Math.min(row.cur_season_index ?? 0, slots.length - 1);
		const episode = Math.min(
			row.cur_episode ?? 0,
			slots[index]?.episode_count ?? 0,
		);

		console.log(
			`  ${row.title.slice(0, 34).padEnd(35)} ${String(row.seasons?.length ?? 0).padStart(2)} -> ${String(slots.length).padStart(2)} parts, ` +
				`${chain.films.length} films, ${chain.sideStories.length} extras` +
				(index !== row.cur_season_index || episode !== row.cur_episode
					? `   (progress ${row.cur_season_index}/${row.cur_episode} -> ${index}/${episode})`
					: ""),
		);

		if (!DRY) {
			await pool.query(
				`UPDATE shows
				    SET seasons = $1, anilist_id = $2, anilist_meta = $3,
				        cur_season_index = $4, cur_episode = $5
				  WHERE id = $6 AND user_id = $7`,
				[
					JSON.stringify(slots),
					chain.anilistId,
					JSON.stringify({
						titleRomaji: meta.titleRomaji ?? null,
						films: meta.films ?? [],
						sideStories: meta.sideStories ?? [],
					}),
					index,
					episode,
					row.id,
					row.user_id,
				],
			);
		}
		rebuilt++;
	}

	console.log(
		`\n${DRY ? "would rebuild" : "rebuilt"} ${rebuilt}, skipped ${skipped}, failed ${failed}`,
	);
	if (DRY) console.log("dry run -- nothing was written");
	await pool.end();
}

main().catch((error) => {
	console.error("backfill failed:", error);
	process.exit(1);
});
