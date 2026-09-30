import { animeEdges, sameProduction } from "./classifyNodes.js";

const LEAD_FORMAT_PRIORITY = new Map([
	["TV", 0],
	["ONA", 1],
	["SPECIAL", 2],
	["OVA", 3],
	["MOVIE", 4],
]);
const leadRank = (anime) => LEAD_FORMAT_PRIORITY.get(anime?.format) ?? Infinity;

// spine entries joined by ALTERNATIVE edges between cuts of one production
function cutGroups(ids, enrichedNodes) {
	const cuts = new Map(ids.map((id) => [id, new Set()]));
	for (const id of ids) {
		const anime = enrichedNodes.get(id);
		for (const edge of animeEdges(anime)) {
			const otherId = edge.node.id;
			if (edge.relationType !== "ALTERNATIVE" || !cuts.has(otherId))
				continue;
			// ALTERNATIVE also links a remake to its original
			if (sameProduction(anime, enrichedNodes.get(otherId)) !== true)
				continue;
			cuts.get(id).add(otherId);
			cuts.get(otherId).add(id);
		}
	}

	const groups = [];
	const seen = new Set();
	for (const startId of cuts.keys()) {
		if (seen.has(startId)) continue;
		seen.add(startId);
		const group = [startId];
		for (let at = 0; at < group.length; at++) {
			for (const otherId of cuts.get(group[at])) {
				if (seen.has(otherId)) continue;
				seen.add(otherId);
				group.push(otherId);
			}
		}
		groups.push(group);
	}
	return groups;
}

// the user's pick, then the root, then the broadcast cut
function pickLead(group, enrichedNodes, rootId, preferredCuts) {
	const picked = group.find((id) => preferredCuts.has(id));
	if (picked != null) return picked;
	if (group.includes(rootId)) return rootId;
	return group.reduce((leadId, id) => {
		const rank = leadRank(enrichedNodes.get(id));
		const leadRankNow = leadRank(enrichedNodes.get(leadId));
		return rank < leadRankNow || (rank === leadRankNow && id < leadId)
			? id
			: leadId;
	});
}

// one slot per production -- the other cuts ride on it as variants
export function collapseAltCuts(
	mainline,
	enrichedNodes,
	rootId,
	preferredCuts = [],
) {
	const preferred = new Set(preferredCuts);
	const shapedById = new Map(
		mainline.map((anime) => [anime.anilistId, anime]),
	);
	const leadById = new Map();
	for (const group of cutGroups([...shapedById.keys()], enrichedNodes)) {
		const leadId = pickLead(group, enrichedNodes, rootId, preferred);
		for (const id of group) leadById.set(id, shapedById.get(leadId));
	}

	const collapsed = [];
	for (const anime of mainline) {
		const lead = leadById.get(anime.anilistId);
		if (anime === lead) {
			collapsed.push(lead);
			continue;
		}
		const { subNodes, variants, ...cut } = anime;
		lead.variants.push({
			...cut,
			isMainLine: false,
			variantKind: "alternate_cut",
		});
	}
	// every cut's id resolves to the slot that carries it
	return { collapsed, franchiseById: leadById };
}
