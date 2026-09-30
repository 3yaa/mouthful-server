import {
	animeEdges,
	findDateParent,
	isFeature,
	isRecapOf,
	SIDE_STORY_MINUTES,
} from "./classifyNodes.js";
import { noteDrop } from "../utils/shapeAnimes.js";

// flip the parent's label so the whole index reads from the additional's side
const INVERSE_RELATION = new Map([
	["PREQUEL", "SEQUEL"],
	["SEQUEL", "PREQUEL"],
	["PARENT", "SIDE_STORY"],
	["SIDE_STORY", "PARENT"],
	["COMPILATION", "CONTAINS"],
	["CONTAINS", "COMPILATION"],
]);
const inverseOf = (relationType) =>
	INVERSE_RELATION.get(relationType) ?? relationType;

const RECUT_RELATIONS = new Set(["SUMMARY", "ALTERNATIVE"]);
const OWN_SERIES_ANCHORS = new Set(["PARENT", "SIDE_STORY"]);
const NOISE_RELATIONS = new Set(["CHARACTER", "OTHER"]);
const ANCHOR_RANK = new Map(
	[
		"PARENT",
		"PREQUEL",
		"ALTERNATIVE",
		"SUMMARY",
		"SEQUEL",
		"SIDE_STORY",
		"CONTAINS",
		"COMPILATION",
	].map((type, rank) => [type, rank]),
);

// every relation between an additional and the spine, read from the additional's side
function relationIndexOf(additionalAnime, spineIds, enrichedNodes) {
	const index = new Map(
		additionalAnime.map((anime) => [anime.anilistId, []]),
	);
	// both directions -- anilist does not always record both ends
	for (const parentId of spineIds) {
		for (const edge of animeEdges(enrichedNodes.get(parentId))) {
			index.get(edge.node.id)?.push({
				relationType: inverseOf(edge.relationType),
				parentId,
			});
		}
	}
	for (const [additionalId, relations] of index) {
		for (const edge of animeEdges(enrichedNodes.get(additionalId))) {
			if (spineIds.has(edge.node.id))
				relations.push({
					relationType: edge.relationType,
					parentId: edge.node.id,
				});
		}
	}
	return index;
}

// best host by ANCHOR_RANK, first seen breaks a tie -- null when nothing but noise
function pickAnchor(relations) {
	let picked = null;
	let best = Infinity;
	for (const relation of relations) {
		if (NOISE_RELATIONS.has(relation.relationType)) continue;
		const rank = ANCHOR_RANK.get(relation.relationType) ?? ANCHOR_RANK.size;
		if (rank < best) {
			best = rank;
			picked = relation;
		}
	}
	return picked;
}

// SUMMARY is a recap outright -- ALTERNATIVE only when the cut is a feature
function isRecut(additional, relations, enrichedNodes) {
	const node = enrichedNodes.get(additional.anilistId);
	return relations.some((relation) => {
		if (!RECUT_RELATIONS.has(relation.relationType)) return false;
		if (relation.relationType === "ALTERNATIVE" && !isFeature(node))
			return false;
		return isRecapOf(node, enrichedNodes.get(relation.parentId));
	});
}

export function relateAdditional(
	additionalAnime,
	spineIds,
	mainlineById,
	mainlineNodes,
	enrichedNodes,
	dropped,
) {
	const relationIndex = relationIndexOf(
		additionalAnime,
		spineIds,
		enrichedNodes,
	);
	for (const additional of additionalAnime) {
		const relations = relationIndex.get(additional.anilistId);
		const anchor = pickAnchor(relations);
		// a recap or nothing but noise
		if (
			isRecut(additional, relations, enrichedNodes) ||
			(!anchor && relations.length > 0)
		) {
			noteDrop(dropped, additional.anilistId);
			continue;
		}
		// a spin-off series is its own show
		if (
			additional.format === "TV" &&
			OWN_SERIES_ANCHORS.has(anchor?.relationType)
		)
			continue;
		if (
			additional.kind === "sideStory" &&
			additional.duration &&
			additional.duration < SIDE_STORY_MINUTES
		) {
			noteDrop(dropped, additional.anilistId);
			continue;
		}
		// no edge names a slot
		const parent =
			mainlineById.get(anchor?.parentId) ??
			findDateParent(mainlineNodes, additional);
		parent?.subNodes.push(additional);
	}
}
