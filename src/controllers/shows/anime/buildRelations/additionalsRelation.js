import { isRecapOf } from "./classifyNodes.js";

const RECUT_RELATIONS = new Set(["SUMMARY", "ALTERNATIVE"]);
const NOISE_RELATIONS = new Set(["SUMMARY", "CHARACTER", "OTHER"]);
const NOISE_REASON = new Map([
	["SUMMARY", "recap"],
	["CHARACTER", "character short"],
	["OTHER", "unrelated"],
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
		const parent = enrichedNodes.get(parentId);
		for (const edge of parent?.relations?.edges ?? []) {
			if (additionalIds.has(edge.node?.id)) {
				add(edge.node.id, edge.relationType, parentId);
			}
		}
	}
	for (const additionalId of additionalIds) {
		const additional = enrichedNodes.get(additionalId);
		for (const edge of additional?.relations?.edges ?? []) {
			if (mainlineIds.has(edge.node?.id)) {
				add(additionalId, edge.relationType, edge.node.id);
			}
		}
	}

	return index;
}

// when an entry's two relations disagree, the trash one win to get dropped :()
function pickRelation(relations = []) {
	return (
		relations.find((relation) => relation.relationType === "SUMMARY") ??
		relations.find((relation) =>
			NOISE_RELATIONS.has(relation.relationType),
		) ??
		relations.find((relation) => relation.relationType === "ALTERNATIVE") ??
		relations.find(
			(relation) => !NOISE_RELATIONS.has(relation.relationType),
		) ??
		relations[0] ??
		null
	);
}

function findDateParent(anime, mainlineNodes) {
	let parent = null;

	for (const candidate of mainlineNodes) {
		if (!anime.startDate || !candidate.startDate) continue;
		if (candidate.startDate <= anime.startDate) parent = candidate;
	}

	return parent ?? mainlineNodes[0] ?? null;
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
		const relation = pickRelation(relationIndex.get(additional.anilistId));
		const relationType = relation?.relationType ?? null;
		// declared summary is not a spine part
		if (
			NOISE_RELATIONS.has(relationType) &&
			!(relationType === "SUMMARY" && additional.kind === "film")
		) {
			dropped.push({
				...additional,
				relationType,
				reason: NOISE_REASON.get(relationType) ?? "unrelated",
			});
			continue;
		}

		// pick what the parent node is
		const parent =
			mainlineById.get(relation?.parentId) ??
			findDateParent(additional, mainlineNodes);
		// no slot to hang from
		if (!parent) {
			dropped.push({ ...additional, relationType, reason: "no parent" });
			continue;
		}

		// for cases like jjk execuation -- recap + early screening
		if (
			additional.kind === "film" &&
			RECUT_RELATIONS.has(relationType) &&
			isRecapOf(
				enrichedNodes?.get(additional.anilistId),
				enrichedNodes?.get(relation.parentId),
			)
		) {
			dropped.push({
				...additional,
				relationType,
				reason: "recut",
				recutOf: parent.anilistId,
			});
			continue;
		}

		// only a spine node can be an alt cut
		parent.subNodes.push({ ...additional, relationType });
	}
}
