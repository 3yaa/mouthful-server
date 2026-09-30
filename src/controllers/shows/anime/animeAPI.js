import { fetchAnilist } from "./externalCalls/anilistAPI.js";
import { relateAdditional } from "./buildRelations/additionalsRelation.js";
import {
	confirmBySpine,
	unlistedKin,
	walkSpine,
} from "./buildRelations/reviewRelations.js";
import { collapseAltCuts } from "./buildRelations/spineNodesAlts.js";
import {
	animeEdges,
	canHoldSpine,
	continuesChain,
	movieTmdbId,
	hangMovies,
	isFeature,
	isBonusShort,
	isInterlude,
	isRecapOf,
	isMovie,
	liftMovies,
	isOffStory,
	isRemake,
	runsAsOwnSeries,
} from "./buildRelations/classifyNodes.js";
import { getFribbMap, rowsFor } from "./externalCalls/fribbMap.js";
import { numberParts } from "./utils/parseParts.js";
import {
	getMangaAdaptation,
	shapeAnime,
	shapeAnimeGroup,
	noteDrop,
} from "./utils/shapeAnimes.js";
import { compareStartDate, pickRoot } from "./utils/utilFunctions.js";
import { shikimoriQuery } from "./externalCalls/shikimoriAPI.js";

async function buildAnimeChain(
	tmdbId,
	preferredCuts = [],
	forceRefresh = false,
) {
	const fribb = await getFribbMap();
	const rootRow = pickRoot(rowsFor(fribb, tmdbId, "tv"));
	if (!rootRow) return null;

	// PHASE 1: get the shikimori's nodes
	const rootMalId = Number(rootRow.malId);
	const franchise = await shikimoriQuery(rootMalId, forceRefresh);
	if (!franchise?.nodes?.length) return null;

	// PHASE 2: link to anilist
	const { byMal, byAnilist } = fribb;
	const candidates = new Set();
	// shikimori's own label for each node
	const kindByAnilist = new Map();
	let rootId = null;
	for (const node of franchise.nodes) {
		const mapped = byMal.get(Number(node.id))?.anilistId;
		if (mapped == null) continue;
		const anilistId = Number(mapped);
		if (Number(node.id) === rootMalId) rootId = anilistId;
		candidates.add(anilistId);
		kindByAnilist.set(anilistId, node.kind);
	}
	if (rootId == null) return null;

	// PHASE 3: enrich with anilist
	const enrichedNodes = await fetchAnilist([...candidates], forceRefresh);
	const rootAnime = enrichedNodes.get(rootId);
	if (!rootAnime) return null;
	// go thru unlinked anilist ids
	const kin = unlistedKin(candidates, enrichedNodes, byAnilist);
	if (kin.size) {
		const adopted = await fetchAnilist([...kin], forceRefresh);
		for (const [anilistId, anime] of adopted) {
			// remove unannouced
			if (!Number.isInteger(anime.startDate?.year)) continue;
			//
			enrichedNodes.set(anilistId, anime);
			candidates.add(anilistId);
		}
	}

	// PHASE 3.5: drop useless additionals and big alternatives
	const dropped = [];
	for (const anilistId of candidates) {
		if (anilistId === rootId) continue;
		const anime = enrichedNodes.get(anilistId);
		const offStory = isOffStory(anime, kindByAnilist.get(anilistId));
		if (!offStory && !runsAsOwnSeries(anime)) continue;
		candidates.delete(anilistId);
		if (offStory) noteDrop(dropped, anilistId);
	}
	// PHASE 4: review shikimori | seperate
	// no confirming edge is dropped
	const anilistSpine = walkSpine(candidates, enrichedNodes, rootId);
	// a remake is its own anime
	for (const anilistId of candidates) {
		if (anilistSpine.has(anilistId)) continue;
		if (isRemake(enrichedNodes.get(anilistId), anilistSpine, enrichedNodes))
			candidates.delete(anilistId);
	}
	const confirmed = confirmBySpine(candidates, enrichedNodes, anilistSpine);
	// a recap can sometimes carry prequel/sequel
	const recaps = new Set();
	for (const anilistId of confirmed) {
		const anime = enrichedNodes.get(anilistId);
		for (const edge of animeEdges(anime)) {
			const targetId = edge.node.id;
			if (edge.relationType !== "SUMMARY" || !confirmed.has(targetId))
				continue;
			if (isRecapOf(enrichedNodes.get(targetId), anime))
				recaps.add(targetId);
		}
	}

	// classify nodes
	const spineIds = new Set();
	const additionalIds = new Set();
	for (const anilistId of confirmed) {
		const anime = enrichedNodes.get(anilistId);
		const interlude = isInterlude(anime, movieTmdbId(anime, byAnilist));
		const holdsSlot =
			(canHoldSpine(anime) ||
				isFeature(anime) ||
				(continuesChain(anime) && !isBonusShort(anime, rootAnime))) &&
			!interlude;
		const onSpine =
			anilistSpine.has(anilistId) &&
			!recaps.has(anilistId) &&
			(anilistId === rootId || holdsSlot);
		if (onSpine) spineIds.add(anilistId);
		else additionalIds.add(anilistId);
	}

	// PHASE 5: build anime shape
	const shapedMainline = shapeAnimeGroup(spineIds, enrichedNodes, true);
	// additional
	const additionalAnime = shapeAnimeGroup(
		additionalIds,
		enrichedNodes,
		false,
	);
	// check what kinda additional they are
	for (const additional of additionalAnime) {
		const node = enrichedNodes.get(additional.anilistId);
		const tmdbMovieId = movieTmdbId(additional, byAnilist);
		additional.kind = isMovie(node, tmdbMovieId) ? "film" : "sideStory";
		if (additional.kind === "film") additional.tmdbMovieId = tmdbMovieId;
	}

	// PHASE 6: build franchise
	const { collapsed: fullFranchise, franchiseById } = collapseAltCuts(
		shapedMainline,
		enrichedNodes,
		rootId,
		preferredCuts,
	);
	fullFranchise.sort(compareStartDate);
	relateAdditional(
		additionalAnime,
		spineIds,
		franchiseById,
		fullFranchise,
		enrichedNodes,
		dropped,
	);
	// movies are not a slot
	const spineMovies = liftMovies(fullFranchise, byAnilist, enrichedNodes);
	hangMovies(spineMovies, fullFranchise, enrichedNodes);
	numberParts(fullFranchise);
	for (const slot of fullFranchise) {
		slot.subNodes.sort(compareStartDate);
		slot.variants.sort(compareStartDate);
	}
	// what rides on the root
	const rootSlot =
		fullFranchise.find((slot) => slot.anilistId === rootId) ??
		fullFranchise[0];
	if (rootSlot) {
		rootSlot.sourceManga = getMangaAdaptation(rootAnime);
		if (dropped.length) rootSlot.droppedNodes = dropped;
	}

	return { root: shapeAnime(rootAnime, true), fullFranchise };
}

export async function startAnimeChain(
	tmdb,
	preferredCuts = [],
	forceRefresh = false,
) {
	try {
		return await buildAnimeChain(tmdb, preferredCuts, forceRefresh);
	} catch (error) {
		console.error("Anime chain failed: ", error.message);
		return null;
	}
}

export function applyChain(processedShow, chain) {
	if (!chain?.fullFranchise?.length) return;
	const { root, fullFranchise } = chain;

	// anime specific attributes
	processedShow.anilistId = root.anilistId;
	processedShow.seasons = fullFranchise;
	if (root?.studio) processedShow.creator = root.studio;
	// sends both tmdb and anilist posters
	const cover = root?.posterUrl ?? fullFranchise[0]?.posterUrl;
	const posters = processedShow.posters ?? [];
	if (cover && !posters.includes(cover)) {
		processedShow.posters = [...posters, cover];
	}
}
