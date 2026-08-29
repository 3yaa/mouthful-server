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
	isFeature,
	isRecapOf,
	isFilm,
	liftFilms,
	offStory,
	remadeFrom,
	runsAsOwnSeries,
} from "./buildRelations/classifyNodes.js";
import { findByTmdb, getFribbMap } from "./externalCalls/fribbMap.js";
import { applyPartsForSeason } from "./utils/parseParts.js";
import {
	getMangaAdaptation,
	shapeAnime,
	shapeAnimeGroup,
	shapeDropped,
	shapeUntranslated,
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
	const dropped = [];
	const candidates = new Set();
	const untranslated = [];
	let rootId = null;
	// shikimori's own label for each node
	const kindByAnilist = new Map();
	//
	const { byMal, byAnilist } = await getFribbMap();
	for (const node of graph.nodes) {
		const malId = Number(node.id);
		const fribbData = byMal.get(malId);
		//
		if (!fribbData || fribbData.anilistId == null) {
			untranslated.push(node);
			dropped.push(shapeUntranslated(node));
			continue;
		}
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

	// PHASE 3.5: drop useless additionals and also removes main nodes if its too big to exist together
	for (const anilistId of [...candidates]) {
		if (anilistId === rootId) continue;
		const anime = enrichedNodes.get(anilistId);
		const reason =
			offStory(anime, kindByAnilist.get(anilistId)) ??
			(runsAsOwnSeries(anime) ? "own series" : null);
		if (!reason) continue;
		//
		candidates.delete(anilistId);
		dropped.push(
			shapeDropped(anime, anilistId, reason, {
				shikimoriKind: kindByAnilist.get(anilistId) ?? null,
			}),
		);
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
		//
		candidates.delete(anilistId);
		dropped.push(
			shapeDropped(anime, anilistId, "separate production", {
				shikimoriKind: kindByAnilist.get(anilistId) ?? null,
				remakeOf: remakes,
			}),
		);
	}
	const { confirmed, rejected } = reviewCandidates(
		candidates,
		enrichedNodes,
		anilistSpine,
	);
	// shikimori owned -- anilist can't find no edge
	for (const anilistId of rejected) {
		dropped.push(
			shapeDropped(
				enrichedNodes.get(anilistId),
				anilistId,
				"no link to the chain",
				{ shikimoriKind: kindByAnilist.get(anilistId) ?? null },
			),
		);
	}
	// a subnode can sometimes carry prequel/sequel (jjk execution bridges s2 and s3)
	const summaryTargets = new Set();
	for (const anime of enrichedNodes.values()) {
		for (const edge of anime?.relations?.edges ?? []) {
			if (edge.relationType !== "SUMMARY") continue;
			const targetId = edge.node?.id;
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
		const onSpine =
			anilistSpine.has(anilistId) &&
			!summaryTargets.has(anilistId) &&
			(anilistId === rootId || canHoldSpine(anime) || isFeature(anime));
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
	//
	for (const anilistId of missingFromAnilist) {
		dropped.push(shapeDropped(null, anilistId, "not on anilist"));
	}
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
		dropped,
	);
	fullFranchise.sort(compareStartDate);
	// add source manga to tree
	const rootNode = franchiseById.get(rootId);
	if (rootNode) {
		rootNode.sourceManga = getMangaAdaptation(rootAnime);
	}
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
	const spineFilms = liftFilms(fullFranchise, byAnilist);
	hangFilms(spineFilms, fullFranchise, enrichedNodes);
	//
	applyPartsForSeason(fullFranchise, compareStartDate);

	return {
		root: shapeAnime(rootAnime, true),
		fullFranchise,
		missingFromAnilist,
		untranslated,
		dropped,
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
		const { root, fullFranchise, dropped } = chain;

		// anime specific attributes
		processedShow.isAnime = true;
		processedShow.anilistId = root.anilistId;
		processedShow.titleRomaji = root.titleRomaji;
		processedShow.seasons = fullFranchise;
		if (root?.studio) processedShow.creator = root.studio;
		//
		if (dropped?.length) processedShow.droppedNodes = dropped;
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
