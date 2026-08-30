import { animeEdges, sameProduction } from "./classifyNodes.js";

const LEAD_FORMAT_PRIORITY = new Map([
	["TV", 0],
	["ONA", 1],
	["SPECIAL", 2],
	["OVA", 3],
	["MOVIE", 4],
]);

function relateAltCuts(mainlineIds, enrichedNodes) {
	const alts = new Map();
	for (const id of mainlineIds) {
		alts.set(id, new Set());
	}
	//
	for (const id of mainlineIds) {
		const anime = enrichedNodes.get(id);
		for (const edge of animeEdges(anime)) {
			if (edge.relationType !== "ALTERNATIVE") continue;
			const otherId = edge.node.id;
			// only looking at spine items
			if (!mainlineIds.has(otherId)) continue;
			// ALTERNATIVE also links a remake to its original
			if (sameProduction(anime, enrichedNodes.get(otherId)) !== true)
				continue;
			// do both if if one side is missing its fills
			alts.get(id).add(otherId);
			alts.get(otherId).add(id);
		}
	}
	return alts;
}

function animesAltCuts(mainlineIds, enrichedNodes) {
	const alts = relateAltCuts(mainlineIds, enrichedNodes);
	// singleton is just by itself
	const animesCuts = [];
	const visited = new Set();

	for (const startId of alts.keys()) {
		if (visited.has(startId)) continue;
		//
		const animeCuts = [];
		const queue = [startId];
		visited.add(startId);

		// traverse all alts
		for (let i = 0; i < queue.length; i++) {
			const currentId = queue[i];
			animeCuts.push(currentId);

			for (const neighborId of alts.get(currentId) ?? []) {
				if (visited.has(neighborId)) continue;
				visited.add(neighborId);
				queue.push(neighborId);
			}
		}
		animesCuts.push(animeCuts);
	}
	return animesCuts;
}

function pickDefaultCuts(
	mainlineIds,
	enrichedNodes,
	rootAnilistId,
	preferredCuts = new Set(),
) {
	const altCutsAnimes = animesAltCuts(mainlineIds, enrichedNodes);
	const leadById = new Map();

	for (const altCutsAnime of altCutsAnimes) {
		const picked = altCutsAnime.find((id) => preferredCuts.has(id));
		let leadId =
			picked ??
			(altCutsAnime.includes(rootAnilistId)
				? rootAnilistId
				: altCutsAnime[0]);
		// user choice wins, including the root cut.
		if (picked == null && leadId !== rootAnilistId) {
			for (let i = 1; i < altCutsAnime.length; i++) {
				const candidateId = altCutsAnime[i];
				const lead = enrichedNodes.get(leadId);
				const candidate = enrichedNodes.get(candidateId);
				const leadRank =
					LEAD_FORMAT_PRIORITY.get(lead?.format) ?? Infinity;
				const candidateRank =
					LEAD_FORMAT_PRIORITY.get(candidate?.format) ?? Infinity;
				//
				if (
					candidateRank < leadRank ||
					(candidateRank === leadRank && candidateId < leadId)
				) {
					leadId = candidateId;
				}
			}
		}
		// singleton maps to themselves
		for (const id of altCutsAnime) leadById.set(id, leadId);
	}
	return leadById;
}

export function collapseAltCuts(
	mainline,
	mainlineIds,
	enrichedNodes,
	rootAnilistId,
	preferredCuts = [],
) {
	const collapsed = [];
	const franchiseById = new Map();
	const leadById = pickDefaultCuts(
		mainlineIds,
		enrichedNodes,
		rootAnilistId,
		new Set(preferredCuts),
	);
	const shapedById = new Map(
		mainline.map((anime) => [anime.anilistId, anime]),
	);

	// walk all mainline entry
	for (const anime of mainline) {
		const leadId = leadById.get(anime.anilistId) ?? anime.anilistId;
		const lead = shapedById.get(leadId);
		if (!lead) continue;
		// lead id and variant ids resolve to lead obj
		franchiseById.set(anime.anilistId, lead);
		// remove the alternative from mainline nodes
		if (anime.anilistId === leadId) {
			collapsed.push(lead);
			continue;
		}
		// remove mainline-only child conatiners varient
		const { subNodes, variants, ...variantMedia } = anime;
		lead.variants.push({
			...variantMedia,
			isMainLine: false,
			variantKind: "alternate_cut",
			relationType: "ALTERNATIVE",
		});
	}
	return {
		collapsed,
		franchiseById,
	};
}
