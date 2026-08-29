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

const SPINE_RELATIONS = new Set(["PREQUEL", "SEQUEL"]);

const edgesOf = (node) => node?.relations?.edges ?? [];

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
		for (const edge of edgesOf(enrichedNodes.get(anilistId))) {
			const other = edge.node;
			if (!SPINE_RELATIONS.has(edge.relationType)) continue;
			if (other?.type !== "ANIME" || !candidates.has(other.id)) continue;
			//
			link(anilistId, other.id);
			link(other.id, anilistId);
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
export function reviewCandidates(candidates, enrichedNodes, spine) {
	const confirmed = new Set(spine);
	const rejected = new Set();

	// everything the spine vouches for, collected in one pass
	const vouchedBySpine = new Set();
	for (const spineId of spine) {
		for (const edge of edgesOf(enrichedNodes.get(spineId))) {
			if (!CONFIRM_RELATIONS.has(edge.relationType)) continue;
			if (edge.node?.id != null) vouchedBySpine.add(edge.node.id);
		}
	}

	for (const anilistId of candidates) {
		if (confirmed.has(anilistId)) continue;
		const node = enrichedNodes.get(anilistId);
		if (!node) {
			rejected.add(anilistId);
			continue;
		}
		// spine wins
		const fromNode = edgesOf(node).some(
			(edge) =>
				spine.has(edge.node?.id) &&
				CONFIRM_RELATIONS.has(edge.relationType),
		);

		if (vouchedBySpine.has(anilistId) || fromNode) confirmed.add(anilistId);
		else rejected.add(anilistId);
	}

	return { confirmed, rejected };
}
