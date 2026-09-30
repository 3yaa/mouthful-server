import { animeEdges, SPINE_RELATIONS } from "./classifyNodes.js";

// SPIN_OFF, CHARACTER, OTHER and ADAPTATION not counted
const CONFIRM_RELATIONS = new Set([
	"PREQUEL",
	"SEQUEL",
	"PARENT",
	"SIDE_STORY",
	"SUMMARY",
	"ALTERNATIVE",
	"COMPILATION",
	"CONTAINS",
]);

// spine as anilist draws it
export function walkSpine(candidates, enrichedNodes, rootId) {
	const linked = new Map();
	const link = (from, to) => {
		const bucket = linked.get(from);
		if (bucket) bucket.add(to);
		else linked.set(from, new Set([to]));
	};
	//
	for (const anilistId of candidates) {
		for (const edge of animeEdges(enrichedNodes.get(anilistId))) {
			const otherId = edge.node.id;
			if (!SPINE_RELATIONS.has(edge.relationType)) continue;
			if (!candidates.has(otherId)) continue;
			//
			link(anilistId, otherId);
			link(otherId, anilistId);
		}
	}

	const spine = new Set([rootId]);
	const queue = [rootId];
	for (let at = 0; at < queue.length; at++) {
		for (const neighbour of linked.get(queue[at]) ?? []) {
			if (spine.has(neighbour)) continue;
			//
			spine.add(neighbour);
			queue.push(neighbour);
		}
	}

	return spine;
}

// anilist backcheck shikimori
export function confirmBySpine(candidates, enrichedNodes, spine) {
	const vouched = new Set();
	for (const spineId of spine) {
		for (const edge of animeEdges(enrichedNodes.get(spineId))) {
			if (CONFIRM_RELATIONS.has(edge.relationType))
				vouched.add(edge.node.id);
		}
	}
	const tied = (anilistId) => {
		const node = enrichedNodes.get(anilistId);
		if (!node) return false;
		if (vouched.has(anilistId)) return true;
		return animeEdges(node).some(
			(edge) =>
				spine.has(edge.node.id) &&
				CONFIRM_RELATIONS.has(edge.relationType),
		);
	};
	return new Set([...spine, ...[...candidates].filter(tied)]);
}

export function unlistedKin(candidates, enrichedNodes, byAnilist) {
	const kin = new Set();

	for (const anilistId of candidates) {
		for (const edge of animeEdges(enrichedNodes.get(anilistId))) {
			const otherId = edge.node.id;
			if (candidates.has(otherId)) continue;
			if (!CONFIRM_RELATIONS.has(edge.relationType)) continue;
			//
			const row = byAnilist.get(otherId);
			if (!row || row.malId != null) continue;
			kin.add(otherId);
		}
	}

	return kin;
}
