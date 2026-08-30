import {
	animeEdges,
	findDateParent,
	isFeature,
	isRecapOf,
} from "./classifyNodes.js";
import { dropShaped } from "../utils/shapeAnimes.js";

const rankMap = (types) => new Map(types.map((type, rank) => [type, rank]));

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

// a shorter cut of whatever it points at
const RECUT_RELATIONS = new Set(["SUMMARY", "ALTERNATIVE"]);

// what a spin-off says about the chain -- a continuation says PREQUEL or SEQUEL
const OWN_SERIES_ANCHORS = new Set(["PARENT", "SIDE_STORY"]);

// drop trash thats has runtime below 12 min
const SIDE_STORY_MINUTES = 12;

// never places an entry -- only the reason one with no other relation leaves
const NOISE_REASON = new Map([
	["CHARACTER", "character short"],
	["OTHER", "unrelated"],
]);
const NOISE_RELATIONS = new Set(NOISE_REASON.keys());
const NOISE_RANK = rankMap([...NOISE_REASON.keys()]);

// what the parent is to the additional, best host first -- unlisted sorts last
const ANCHOR_RANK = rankMap([
	"PARENT",
	"PREQUEL",
	"ALTERNATIVE",
	"SUMMARY",
	"SEQUEL",
	"SIDE_STORY",
	"CONTAINS",
	"COMPILATION",
]);

export function buildRelationIndex(mainlineIds, additionalIds, enrichedNodes) {
	const index = new Map();
	const add = (additionalId, relationType, parentId) => {
		const relation = { relationType, parentId };
		// another relation
		const bucket = index.get(additionalId);
		if (bucket) bucket.push(relation);
		// first relation
		else index.set(additionalId, [relation]);
	};

	// read both directions
	for (const parentId of mainlineIds) {
		for (const edge of animeEdges(enrichedNodes.get(parentId))) {
			if (additionalIds.has(edge.node.id)) {
				add(edge.node.id, inverseOf(edge.relationType), parentId);
			}
		}
	}
	for (const additionalId of additionalIds) {
		for (const edge of animeEdges(enrichedNodes.get(additionalId))) {
			if (mainlineIds.has(edge.node.id)) {
				add(additionalId, edge.relationType, edge.node.id);
			}
		}
	}

	return index;
}

// lowest rank wins, first seen breaks a tie
function pickByRank(relations, ranks, unranked) {
	let picked = null;
	let best = Infinity;

	for (const relation of relations) {
		const rank = ranks.get(relation.relationType) ?? unranked;
		if (rank < best) {
			best = rank;
			picked = relation;
		}
	}

	return picked;
}

// SUMMARY is a recap outright -- ALTERNATIVE only when the cut is a feature
function findRecut(additional, relations, enrichedNodes) {
	const node = enrichedNodes?.get(additional.anilistId);

	return (
		relations.find((relation) => {
			if (!RECUT_RELATIONS.has(relation.relationType)) return false;
			if (relation.relationType === "ALTERNATIVE" && !isFeature(node))
				return false;
			return isRecapOf(node, enrichedNodes?.get(relation.parentId));
		}) ?? null
	);
}

export function relateAdditional(
	additionalAnime,
	relationIndex,
	mainlineById,
	mainlineNodes,
	enrichedNodes,
	dropped = [],
) {
	for (const additional of additionalAnime) {
		const relations = relationIndex.get(additional.anilistId) ?? [];

		const recut = findRecut(additional, relations, enrichedNodes);
		if (recut) {
			const host = mainlineById.get(recut.parentId);
			dropped.push(
				dropShaped(additional, "recut", {
					relationType: recut.relationType,
					recutOf: host?.anilistId ?? recut.parentId,
				}),
			);
			continue;
		}

		const anchor = pickByRank(
			relations.filter(
				(relation) => !NOISE_RELATIONS.has(relation.relationType),
			),
			ANCHOR_RANK,
			ANCHOR_RANK.size,
		);
		// nothing but noise
		if (!anchor && relations.length) {
			const noise = pickByRank(relations, NOISE_RANK, Infinity);
			dropped.push(
				dropShaped(
					additional,
					NOISE_REASON.get(noise.relationType) ?? "unrelated",
					{ relationType: noise.relationType },
				),
			);
			continue;
		}

		const relationType = anchor?.relationType ?? null;
		// remove alternatives 
		if (
			additional.format === "TV" &&
			OWN_SERIES_ANCHORS.has(relationType)
		) {
			dropped.push(
				dropShaped(additional, "own series", { relationType }),
			);
			continue;
		}

		// remove trash
		if (
			additional.kind === "sideStory" &&
			additional.duration &&
			additional.duration < SIDE_STORY_MINUTES
		) {
			dropped.push(
				dropShaped(additional, "bonus short", { relationType }),
			);
			continue;
		}

		// pick what the parent node is
		const parent =
			mainlineById.get(anchor?.parentId) ??
			findDateParent(mainlineNodes, additional);
		// no slot to hang from
		if (!parent) {
			dropped.push(dropShaped(additional, "no parent", { relationType }));
			continue;
		}

		parent.subNodes.push({ ...additional, relationType });
	}
}
