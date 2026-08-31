import { getFribbMap } from "./externalCalls/fribbMap.js";
import { shikimoriQuery } from "./externalCalls/shikimoriAPI.js";
import { fetchAnilist } from "./externalCalls/anilistAPI.js";
import { anilistSearch } from "./externalCalls/anilistSearch.js";
import { canHoldSpine } from "./buildRelations/classifyNodes.js";
import { chainIdsOf } from "./utils/utilFunctions.js";
import { startAnimeChain } from "./animeAPI.js";

// how many candidate roots are worth building for one add
const MAX_ROOTS = 3;

const rowByImdb = ({ byImdb }, imdbId) =>
	imdbId ? (byImdb.get(imdbId) ?? null) : null;

// the ids the franchise graph names, in anilist terms
function anilistIdsOf(graph, byMal) {
	const out = [];
	for (const node of graph?.nodes ?? []) {
		const id = byMal.get(Number(node.id))?.anilistId;
		if (id != null) out.push(Number(id));
	}
	return out;
}

// tv ids the chain could root on, earliest first -- a film-only graph has none
async function tvRootsOf(graph, fribb) {
	const ids = anilistIdsOf(graph, fribb.byMal);
	if (!ids.length) return [];
	const enriched = await fetchAnilist(ids);
	const candidates = [];
	for (const [anilistId, anime] of enriched) {
		if (!canHoldSpine(anime)) continue;
		const mapped = fribb.byAnilist.get(anilistId);
		if (mapped?.tmdbType !== "tv" || typeof mapped.tmdbId !== "number")
			continue;
		candidates.push({
			tv: mapped.tmdbId,
			year: anime.startDate?.year ?? 9999,
		});
	}
	candidates.sort((a, z) => a.year - z.year);
	return [...new Set(candidates.map((c) => c.tv))].slice(0, MAX_ROOTS);
}

// on some chain? builds the chain and asks -- never classifies itself
export async function resolveAnimeFilm({ imdbId, title, year }) {
	const fribb = await getFribbMap();
	let row = rowByImdb(fribb, imdbId);

	// the imdb misses are rows with a null imdb_id, mostly recent releases
	if (!row && title) {
		const found = await anilistSearch(title, year);
		if (found) row = fribb.byAnilist.get(found.id) ?? null;
	}
	// not in the anime id map at all
	if (!row?.malId) return { kind: "movie", why: "not an anime entry" };
	if (row.anilistId == null)
		return { kind: "movie", why: "no anilist id to place it by" };

	let graph;
	try {
		graph = await shikimoriQuery(Number(row.malId));
	} catch {
		return { kind: "movie", why: "no franchise record" };
	}
	if (!graph?.nodes?.length)
		return { kind: "movie", why: "stands on its own" };

	const roots = await tvRootsOf(graph, fribb);
	if (!roots.length)
		return { kind: "movie", why: "no series for a chain to be rooted on" };

	const filmId = Number(row.anilistId);
	for (const tv of roots) {
		const chain = await startAnimeChain(tv);
		if (!chain?.fullFranchise?.length) continue;
		if (!chainIdsOf(chain.fullFranchise, chain.root?.anilistId).has(filmId))
			continue;
		return {
			kind: "show",
			why: `on the ${chain.root?.title} chain`,
			showTitle: chain.root?.title ?? null,
			tmdbId: String(tv),
			anilistId: filmId,
			// spine parts, not the length of the watch order
			parts: chain.fullFranchise.length,
		};
	}
	// dropped as an independent work, a remake, or a recap
	return { kind: "movie", why: "not on this franchise's chain" };
}

// GET /movies-api/anime-film -- asked before the movies flow makes a row
export async function useAnimeFilmResolveAPI(req, res) {
	try {
		const { imdbId, title, year } = req.query;
		const resolved = await resolveAnimeFilm({
			imdbId: imdbId ?? null,
			title: title ?? null,
			// NaN reads as no year
			year: Number.isFinite(Number(year)) ? Number(year) : null,
		});
		res.json({ success: true, data: resolved });
	} catch (error) {
		console.error("Anime film resolve failed: ", error.message);
		// don't blocks an add
		res.json({
			success: true,
			data: { kind: "movie", why: "lookup failed" },
		});
	}
}
