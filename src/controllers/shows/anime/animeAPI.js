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
	canHoldSpine,
	filmTmdbId,
	hangFilms,
	isFilm,
	liftFilms,
} from "./buildRelations/classifyNodes.js";
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

	// PHASE 2: link to anilist
	const candidates = new Set();
	const untranslated = [];
	let rootId = null;
	//
	const { byMal, byAnilist } = await getFribbMap();
	for (const node of graph.nodes) {
		const malId = Number(node.id);
		const fribbData = byMal.get(malId);
		//
		if (!fribbData || fribbData.anilistId == null) {
			untranslated.push(node);
			continue;
		}
		//
		const anilistId = Number(fribbData.anilistId);
		if (malId === rootMalId) rootId = anilistId;
		candidates.add(anilistId);
	}
	if (rootId == null) return null;

	// PHASE 3: enrich with anilist
	const enrichedNodes = await fetchAnilist([...candidates], forceRefresh);
	const rootAnime = enrichedNodes.get(rootId);
	if (!rootAnime) return null;

	// PHASE 4: review shikimori | seperate
	// no confirming edge is dropped
	const anilistSpine = walkSpine(candidates, enrichedNodes, rootId);
	const { confirmed } = reviewCandidates(
		candidates,
		enrichedNodes,
		anilistSpine,
	);
	// classify nodes
	const spineIds = new Set();
	const additionalIds = new Set();
	for (const anilistId of confirmed) {
		const anime = enrichedNodes.get(anilistId);
		const onSpine =
			anilistSpine.has(anilistId) &&
			(anilistId === rootId || canHoldSpine(anime));
		if (onSpine) spineIds.add(anilistId);
		else additionalIds.add(anilistId);
	}

	// PHASE 5: build anime shape
	const missingFromAnilist = [];
	const shapedMainline = shapeAnimeGroup(
		spineIds,
		enrichedNodes,
		true,
		missingFromAnilist,
	);
	// additional
	const additionalAnime = shapeAnimeGroup(
		additionalIds,
		enrichedNodes,
		false,
		missingFromAnilist,
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
	// add source manga to tree
	const rootNode = franchiseById.get(rootId);
	if (rootNode) {
		rootNode.sourceManga = getMangaAdaptation(rootAnime);
	}
	// films are not a slot
	const spineFilms = liftFilms(fullFranchise, byAnilist);

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
	);
	hangFilms(spineFilms, fullFranchise);
	//
	applyPartsForSeason(fullFranchise, compareStartDate);

	return {
		root: shapeAnime(rootAnime, true),
		fullFranchise,
		missingFromAnilist,
		untranslated,
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
