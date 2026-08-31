import { pool } from "../../../../config/db.js";
import { runAnime } from "./isAnimeCheck.js";
import { applyChain, startAnimeChain } from "../animeAPI.js";
import { getFribbMap, rowsFor } from "../externalCalls/fribbMap.js";

export function pickRoot(rows) {
	// make sure mal id exists
	const usable = rows.filter((row) => Number.isFinite(row.malId));
	return (
		usable.find((row) => row.season === 1) ??
		usable.find((row) => row.type === "TV") ??
		usable[0] ??
		null
	);
}

// walk tmdb series for the original
export async function pickAnimeResult(results) {
	const fribb = await getFribbMap();
	for (const result of results ?? []) {
		if (pickRoot(rowsFor(fribb, result.id, "tv"))) return result;
	}
	return null;
}

export function compareStartDate(a, b) {
	if (a.startDate && !b.startDate) return -1;
	if (!a.startDate && b.startDate) return 1;
	if (!a.startDate && !b.startDate) return a.anilistId - b.anilistId;

	const comparison = a.startDate.localeCompare(b.startDate);
	return comparison || a.anilistId - b.anilistId;
}

// ----- FROM SHOW.API

export const cutIdsFromQuery = (cuts) =>
	String(cuts ?? "")
		.split(",")
		.map(Number)
		.filter((id) => Number.isSafeInteger(id) && id > 0);

// take film out of the slot
export function activeAnimeCutIds(seasons) {
	const active = [];
	for (const season of seasons ?? []) {
		active.push(season);
		for (const subNode of season?.subNodes ?? []) {
			if (subNode?.kind === "film" && subNode.isMainLine)
				active.push(subNode);
		}
	}
	return active
		.map((item) => Number(item?.anilistId))
		.filter((id) => Number.isSafeInteger(id) && id > 0);
}

export const idOf = (item) => Number(item?.anilistId);

//
export function positionsOf(seasons, hiddenSides) {
	// numbers on both sides
	const hidden = new Set((hiddenSides ?? []).map(Number));
	const out = [];
	for (const season of seasons ?? []) {
		out.push(season);
		for (const subNode of season?.subNodes ?? []) {
			if (hidden.has(Number(subNode.anilistId))) continue;
			if (subNode?.kind === "sideStory" || subNode?.kind === "film")
				out.push(subNode);
		}
	}
	return out;
}

// every anilist id the row accounts for -- what a part mark is allowed to name
export function chainIdsOf(seasons, rootId) {
	const ids = new Set();
	const take = (id) => Number.isSafeInteger(id) && id > 0 && ids.add(id);
	take(Number(rootId));
	for (const season of seasons ?? []) {
		take(idOf(season));
		for (const variant of season?.variants ?? []) take(idOf(variant));
		for (const subNode of season?.subNodes ?? []) {
			take(idOf(subNode));
			for (const variant of subNode?.variants ?? []) take(idOf(variant));
		}
	}
	return ids;
}

export async function storedAnimeState(userId, tmdbId) {
	const { rows } = await pool.query(
		`SELECT seasons FROM shows
		 WHERE user_id=$1 AND tmdb_id=$2 AND anilist_id IS NOT NULL
		 LIMIT 1`,
		[userId, tmdbId],
	);
	if (!rows.length) return null;
	return { cuts: activeAnimeCutIds(rows[0].seasons) };
}

export async function applyAnime(
	processedShow,
	tmdbId,
	forceAnime,
	detected,
	cuts,
	refresh,
	pending,
) {
	if (!runAnime(forceAnime, detected)) return;
	try {
		const chain = pending
			? await pending
			: await startAnimeChain(tmdbId, cuts, refresh);
		applyChain(processedShow, chain);
	} catch (error) {
		// anime enrichment is non-blocking; TMDB still gives a usable row.
		console.error("Anime chain failed: ", error.message);
	}
}
