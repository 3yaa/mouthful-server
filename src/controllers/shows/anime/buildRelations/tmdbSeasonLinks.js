import { animeEdges } from "./classifyNodes.js";
import { walkSpine } from "./reviewRelations.js";
import { tmdbSeasonAirDates } from "../externalCalls/tmdbSeasonsAPI.js";

const SERIES = new Set(["TV", "TV_SHORT", "ONA"]);
const DELIBERATE = new Set([
	"SIDE_STORY",
	"SPIN_OFF",
	"ALTERNATIVE",
	"SUMMARY",
	"PARENT",
	"COMPILATION",
	"CONTAINS",
]);
const SEASON_SLACK = 7 * 24 * 60 * 60 * 1000;

const isSeries = (anime) => SERIES.has(anime?.format);

const relationTo = (anime, otherId) =>
	animeEdges(anime).find((edge) => edge.node.id === otherId)?.relationType;

// OTHER or nothing, both ways
const looselyLinked = (a, b) =>
	[relationTo(a, b.id), relationTo(b, a.id)].every(
		(relation) => relation == null || relation === "OTHER",
	);

const placedOnPurpose = (anime, spine) =>
	animeEdges(anime).some(
		(edge) => DELIBERATE.has(edge.relationType) && spine.has(edge.node.id),
	);

const fullStart = (anime) => {
	const date = anime?.startDate;
	if (![date?.year, date?.month, date?.day].every(Number.isInteger))
		return null;
	return Date.UTC(date.year, date.month - 1, date.day);
};

const startOrder = (anime) => {
	const date = anime?.startDate;
	if (!Number.isInteger(date?.year)) return Infinity;
	return Date.UTC(date.year, (date.month ?? 1) - 1, date.day ?? 1);
};

// cloned -- the anilist cache holds the originals
function setRelation(enrichedNodes, fromId, toId, relationType) {
	const from = enrichedNodes.get(fromId);
	const to = enrichedNodes.get(toId);
	const edges = [...(from.relations?.edges ?? [])];
	const at = edges.findIndex((edge) => edge.node?.id === toId);
	if (at >= 0) edges[at] = { ...edges[at], relationType };
	else
		edges.push({
			relationType,
			node: {
				id: toId,
				type: "ANIME",
				format: to.format,
				title: to.title,
			},
		});
	enrichedNodes.set(fromId, {
		...from,
		relations: { ...from.relations, edges },
	});
}

// anilist's OTHER hides a real season when the row's own tmdb show files it as one
export async function linkTmdbSeasons(
	enrichedNodes,
	candidates,
	rootId,
	tmdbId,
) {
	const spine = walkSpine(candidates, enrichedNodes, rootId);
	const joins = [];
	const seen = new Set();
	for (const id of candidates) {
		const anime = enrichedNodes.get(id);
		for (const edge of animeEdges(anime)) {
			const otherId = edge.node.id;
			if (edge.relationType !== "OTHER" || !candidates.has(otherId))
				continue;
			// one end on the spine, the other off it
			if (spine.has(id) === spine.has(otherId)) continue;
			const pair = id < otherId ? `${id}:${otherId}` : `${otherId}:${id}`;
			if (seen.has(pair)) continue;
			seen.add(pair);
			const other = enrichedNodes.get(otherId);
			if (
				!isSeries(anime) ||
				!isSeries(other) ||
				!looselyLinked(anime, other)
			)
				continue;
			const [spineId, freshId] = spine.has(id)
				? [id, otherId]
				: [otherId, id];
			if (placedOnPurpose(enrichedNodes.get(freshId), spine)) continue;
			joins.push([spineId, freshId]);
		}
	}
	if (!joins.length) return;

	const airs = await tmdbSeasonAirDates(tmdbId);
	const seasonOf = (anime) => {
		const start = fullStart(anime);
		if (start == null) return -1;
		return airs.findIndex((air) => Math.abs(air - start) <= SEASON_SLACK);
	};
	// a season the spine already fills takes no newcomer
	const claimed = new Set(
		[...spine]
			.map((id) => seasonOf(enrichedNodes.get(id)))
			.filter((season) => season >= 0),
	);
	for (const [spineId, freshId] of joins) {
		const season = seasonOf(enrichedNodes.get(freshId));
		if (season < 0 || claimed.has(season)) continue;
		claimed.add(season);
		const [first, second] =
			startOrder(enrichedNodes.get(spineId)) <=
			startOrder(enrichedNodes.get(freshId))
				? [spineId, freshId]
				: [freshId, spineId];
		setRelation(enrichedNodes, first, second, "SEQUEL");
		setRelation(enrichedNodes, second, first, "PREQUEL");
	}
}
