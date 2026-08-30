import { fetchAnilist } from "./externalCalls/anilistAPI.js";
import {
	buildRelationIndex,
	relateAdditional,
} from "./buildRelations/additionalsRelation.js";
import {
	reviewCandidates,
	walkSpine,
} from "./buildRelations/reviewRelations.js";
import { collapseAltCuts } from "./buildRelations/spineNodesAlts.js";
import {
	animeEdges,
	canHoldSpine,
	continuesChain,
	filmTmdbId,
	hangFilms,
	isFeature,
	isInterlude,
	isRecapOf,
	isFilm,
	liftFilms,
	isOffStory,
	remadeFrom,
	runsAsOwnSeries,
} from "./buildRelations/classifyNodes.js";
import { getFribbMap, rowsFor } from "./externalCalls/fribbMap.js";
import { applyPartsForSeason } from "./utils/parseParts.js";
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

	// PHASE 1: get the shikimori's nodes and links
	const rootMalId = Number(rootRow.malId);
	const rawFranchise = await shikimoriQuery(rootMalId, forceRefresh);
	if (!rawFranchise?.nodes?.length) return null;
	// normalize the franchise tree
	const graph = {
		nodes: rawFranchise.nodes,
		links: (rawFranchise.links ?? []).map((link) => ({
			...link,
			relation: String(link.relation ?? "").toLowerCase(),
		})),
	};

	// PHASE 2: link to anilist
	const dropped = [];
	const candidates = new Set();
	let rootId = null;
	// shikimori's own label for each node
	const kindByAnilist = new Map();
	//
	const { byMal, byAnilist } = fribb;
	for (const node of graph.nodes) {
		const malId = Number(node.id);
		const fribbData = byMal.get(malId);
		if (!fribbData || fribbData.anilistId == null) continue;
		//
		const anilistId = Number(fribbData.anilistId);
		if (malId === rootMalId) rootId = anilistId;
		candidates.add(anilistId);
		kindByAnilist.set(anilistId, node.kind ?? null);
	}
	if (rootId == null) return null;

	// PHASE 3: enrich with anilist
	const enrichedNodes = await fetchAnilist([...candidates], forceRefresh);
	const rootAnime = enrichedNodes.get(rootId);
	if (!rootAnime) return null;

	// PHASE 3.5: drop useless additionals and big alternatives
	for (const anilistId of [...candidates]) {
		if (anilistId === rootId) continue;
		const anime = enrichedNodes.get(anilistId);
		const offStory = isOffStory(anime, kindByAnilist.get(anilistId));
		const ownSeries = runsAsOwnSeries(anime);
		if (!offStory && !ownSeries) continue;
		//
		candidates.delete(anilistId);
		if (offStory) noteDrop(dropped, anilistId);
	}
	// PHASE 4: review shikimori | seperate
	// no confirming edge is dropped
	const anilistSpine = walkSpine(candidates, enrichedNodes, rootId);
	// remake its own anime
	for (const anilistId of [...candidates]) {
		if (anilistId === rootId || anilistSpine.has(anilistId)) continue;
		const anime = enrichedNodes.get(anilistId);
		const remakes = remadeFrom(anime, anilistSpine, enrichedNodes);
		if (remakes == null) continue;
		// remake dropped
		candidates.delete(anilistId);
	}
	const { confirmed } = reviewCandidates(
		candidates,
		enrichedNodes,
		anilistSpine,
	);
	// a subnode can sometimes carry prequel/sequel (jjk execution bridges s2 and s3)
	const summaryTargets = new Set();
	for (const anilistId of confirmed) {
		const anime = enrichedNodes.get(anilistId);
		for (const edge of animeEdges(anime)) {
			if (edge.relationType !== "SUMMARY") continue;
			const targetId = edge.node.id;
			if (!confirmed.has(targetId)) continue;
			//
			if (!isRecapOf(enrichedNodes.get(targetId), anime)) continue;
			summaryTargets.add(targetId);
		}
	}

	// classify nodes
	const spineIds = new Set();
	const additionalIds = new Set();
	for (const anilistId of confirmed) {
		const anime = enrichedNodes.get(anilistId);
		const interlude = isInterlude(anime, filmTmdbId(anime, byAnilist));
		const holdsSlot =
			(canHoldSpine(anime) ||
				isFeature(anime) ||
				continuesChain(anime)) &&
			!interlude;
		const onSpine =
			anilistSpine.has(anilistId) &&
			!summaryTargets.has(anilistId) &&
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
		const tmdbMovieId = filmTmdbId(additional, byAnilist);
		additional.kind = isFilm(node, tmdbMovieId) ? "film" : "sideStory";
		if (additional.kind === "film") additional.tmdbMovieId = tmdbMovieId;
	}

	// PHASE 6: build franchise
	const { collapsed: fullFranchise, franchiseById } = collapseAltCuts(
		shapedMainline,
		spineIds,
		enrichedNodes,
		rootId,
		preferredCuts,
	);
	fullFranchise.sort(compareStartDate);
	// relate additional onto parent
	const relationIndex = buildRelationIndex(
		spineIds,
		additionalIds,
		enrichedNodes,
	);
	relateAdditional(
		additionalAnime,
		relationIndex,
		franchiseById,
		fullFranchise,
		enrichedNodes,
		dropped,
	);
	// films are not a slot
	const spineFilms = liftFilms(fullFranchise, byAnilist, enrichedNodes);
	hangFilms(spineFilms, fullFranchise, enrichedNodes);
	//
	applyPartsForSeason(fullFranchise, compareStartDate);
	// what rides on the root
	const rootSlot =
		fullFranchise.find((slot) => slot.anilistId === rootId) ??
		fullFranchise[0];
	if (rootSlot) {
		rootSlot.sourceManga = getMangaAdaptation(rootAnime);
		if (dropped.length) rootSlot.droppedNodes = dropped;
	}

	return {
		root: shapeAnime(rootAnime, true),
		fullFranchise,
		dropped,
	};
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
	if (!chain?.fullFranchise?.length) return false;
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

	return true;
}

export async function applyAnimeChain(
	processedShow,
	tmdb,
	preferredCuts = [],
	forceRefresh = false,
) {
	return applyChain(
		processedShow,
		await startAnimeChain(tmdb, preferredCuts, forceRefresh),
	);
}
