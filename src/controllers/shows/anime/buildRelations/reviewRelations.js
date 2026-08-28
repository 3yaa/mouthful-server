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
	//
	while (queue.length > 0) {
		for (const neighbour of linked.get(queue.shift()) ?? []) {
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

	for (const anilistId of candidates) {
		if (confirmed.has(anilistId)) continue;
		const node = enrichedNodes.get(anilistId);
		if (!node) {
			rejected.add(anilistId);
			continue;
		}
		// spine wins
		const fromSpine = [...spine].some((spineId) =>
			edgesOf(enrichedNodes.get(spineId)).some(
				(edge) =>
					edge.node?.id === anilistId &&
					CONFIRM_RELATIONS.has(edge.relationType),
			),
		);
		const fromNode = edgesOf(node).some(
			(edge) =>
				spine.has(edge.node?.id) &&
				CONFIRM_RELATIONS.has(edge.relationType),
		);

		if (fromSpine || fromNode) confirmed.add(anilistId);
		else rejected.add(anilistId);
	}

	return { confirmed, rejected };
}
