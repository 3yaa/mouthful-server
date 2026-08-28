import { fetchAnilist } from "./externalCalls/anilistAPI.js";
import {
	buildRelationIndex,
	relateAdditional,
} from "./buildRelations/additionalsRelation.js";
import { getRelationMap } from "./buildRelations/linkingToBucket.js";
import { collapseAltCuts } from "./buildRelations/spineNodesAlts.js";
import { findByTmdb, getFribbMap } from "./externalCalls/fribbMap.js";
import { applyPartsForSeason } from "./utils/parseParts.js";
import {
	getMangaAdaptation,
	shapeAnime,
	shapeAnimeGroup,
} from "./utils/shapeAnimes.js";
import { compareStartDate, pickRoot } from "./utils/utilFunctions.js";
import { shikimoriQuery } from "./externalCalls/shikimoriAPI.js";

async function buildAnimeChain(
	tmdbId,
	preferredCuts = [],
	forceRefresh = false,
) {
	const rows = await findByTmdb(tmdbId, "tv");
	const rootRow = pickRoot(rows);
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

	// PHASE 2: build relation between shikimori's node and links
	const { spine, additionals } = getRelationMap(graph, rootMalId);

	// PHASE 3: link to anilist
	const anilistGraph = {
		rootId: null,
		spine: new Set(),
		additionals: new Set(),
		untranslated: [],
	};
	//
	const { byMal, byAnilist } = await getFribbMap();
	for (const node of graph.nodes) {
		const malId = Number(node.id);
		const fribbData = byMal.get(malId);
		//
		if (!fribbData || fribbData.anilistId == null) {
			anilistGraph.untranslated.push(node);
			continue;
		}
		//
		const anilistId = Number(fribbData.anilistId);
		if (malId === rootMalId) {
			anilistGraph.rootId = anilistId;
		}
		// convert mal to anilistId
		if (spine.has(malId)) {
			anilistGraph.spine.add(anilistId);
		} else if (additionals.has(malId)) {
			anilistGraph.additionals.add(anilistId);
		}
	}
	if (anilistGraph.rootId == null) return null;

	// PHASE 4: get anilist payload for each node
	const anilistIds = [
		...new Set([...anilistGraph.spine, ...anilistGraph.additionals]),
	];
	const enrichedNodes = await fetchAnilist(anilistIds, forceRefresh);
	const rootAnime = enrichedNodes.get(anilistGraph.rootId);
	if (!rootAnime) return null;

	// PHASE 5: build anime shape
	const missingFromAnilist = [];
	const shapedMainline = shapeAnimeGroup(
		anilistGraph.spine,
		enrichedNodes,
		true,
		missingFromAnilist,
	);
	const additionalAnime = shapeAnimeGroup(
		anilistGraph.additionals,
		enrichedNodes,
		false,
		missingFromAnilist,
	);

	// PHASE 6: build franchise
	const { collapsed: fullFranchise, franchiseById } = collapseAltCuts(
		shapedMainline,
		anilistGraph.spine,
		enrichedNodes,
		anilistGraph.rootId,
		preferredCuts,
	);
	fullFranchise.sort(compareStartDate);
	// add source manga to tree
	const rootNode = franchiseById.get(anilistGraph.rootId);
	if (rootNode) {
		rootNode.sourceManga = getMangaAdaptation(rootAnime);
	}
	// relate additional onto parent
	const relationIndex = buildRelationIndex(
		anilistGraph.spine,
		anilistGraph.additionals,
		enrichedNodes,
	);
	relateAdditional(
		additionalAnime,
		relationIndex,
		franchiseById,
		fullFranchise,
	);
	// for films get tmdbId
	for (const slot of fullFranchise) {
		for (const sub of slot.subNodes ?? []) {
			if (sub.kind !== "film") continue;
			const mapped = byAnilist.get(sub.anilistId);
			sub.tmdbMovieId =
				mapped?.tmdbType === "movie" ? (mapped.tmdbId ?? null) : null;
		}
	}
	//
	applyPartsForSeason(fullFranchise, compareStartDate);

	return {
		root: shapeAnime(rootAnime, true),
		fullFranchise,
		missingFromAnilist,
		untranslated: anilistGraph.untranslated,
	};
}

export async function applyAnimeChain(
	processedShow,
	tmdb,
	preferredCuts = [],
	forceRefresh = false,
) {
	try {
		const chain = await buildAnimeChain(tmdb, preferredCuts, forceRefresh);
		if (!chain?.fullFranchise?.length) return false;
		const { root, fullFranchise } = chain;

		// anime specific attributes
		processedShow.isAnime = true;
		processedShow.anilistId = root.anilistId;
		processedShow.titleRomaji = root.titleRomaji;
		processedShow.seasons = fullFranchise;
		if (root?.studio) processedShow.creator = root.studio;
		// sends both tmdb and anilist posters
		const cover = root?.posterUrl ?? fullFranchise[0]?.posterUrl;
		const posters = processedShow.posters ?? [];
		if (cover && !posters.includes(cover)) {
			processedShow.posters = [...posters, cover];
		}

		return true;
	} catch (error) {
		console.error("Anime chain failed: ", error.message);
		return false;
	}
}
