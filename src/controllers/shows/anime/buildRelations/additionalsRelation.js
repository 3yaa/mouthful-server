const NOISE_RELATIONS = new Set(["SUMMARY", "CHARACTER", "OTHER"]);

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

// if has trash relation type then disregard any other relation type it might have
function pickRelation(relations = []) {
	return (
		relations.find((relation) => relation.relationType === "SUMMARY") ??
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
) {
	for (const additional of additionalAnime) {
		const relation = pickRelation(relationIndex.get(additional.anilistId));
		const relationType = relation?.relationType ?? null;
		// declared summary is not a spine part
		if (
			NOISE_RELATIONS.has(relationType) &&
			!(relationType === "SUMMARY" && additional.kind === "film")
		) {
			continue;
		}

		// pick what the parent node is
		const parent =
			mainlineById.get(relation?.parentId) ??
			findDateParent(additional, mainlineNodes);
		if (!parent) continue;

		//
		if (relationType === "ALTERNATIVE") {
			// movie not another slot
			const { kind, tmdbMovieId, ...variantMedia } = additional;
			parent.variants.push({
				...variantMedia,
				variantKind: "alternate_cut",
				relationType,
			});
		} else {
			parent.subNodes.push({ ...additional, relationType });
		}
	}
}
