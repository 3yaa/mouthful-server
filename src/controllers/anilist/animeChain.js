import { anilistQuery, titleMatches } from "./anilistClient.js";

// TMDB's own "anime" keyword
const TMDB_ANIME_KEYWORD = 210024;
const TMDB_ANIMATION_GENRE = 16;
const ANIME_ORIGINS = ["JP", "CN", "KR", "TW"];

// donghua are almost always ONA
const MAIN_FORMATS = ["TV", "ONA", "MOVIE"];
// promo shorts, tie-ins and recaps -- delete
const NOISE_RELATIONS = ["CHARACTER", "OTHER", "SPIN_OFF", "SUMMARY"];
const SIDE_FORMATS = ["OVA", "SPECIAL", "TV_SHORT"];

// genre+origi
export function isAnime(tmdbDetail) {
	const genres = (tmdbDetail?.genres ?? []).map((g) => g.id);
	const keywords = (tmdbDetail?.keywords?.results ?? []).map((k) => k.id);
	if (keywords.includes(TMDB_ANIME_KEYWORD)) return true;

	const origins = tmdbDetail?.origin_country ?? [];
	return (
		genres.includes(TMDB_ANIMATION_GENRE) &&
		origins.some((c) => ANIME_ORIGINS.includes(c))
	);
}

const MEDIA_FIELDS = `
	id type format episodes duration averageScore
	title { romaji english native }
	startDate { year month }
	coverImage { extraLarge color }
	bannerImage
`;

//
const RESOLVE = `query Resolve($search: String!, $year: Int) {
	Page(perPage: 1) {
		media(type: ANIME, search: $search, seasonYear: $year, sort: SEARCH_MATCH) {
			${MEDIA_FIELDS}
			relations { edges { relationType node {
				${MEDIA_FIELDS}
				relations { edges { relationType node { ${MEDIA_FIELDS} } } }
			} } }
		}
	}
}`;

const sortKey = (n) =>
	(n.startDate?.year ?? 9999) * 100 + (n.startDate?.month ?? 1);

const asDate = (n) =>
	n.startDate?.year
		? `${n.startDate.year}-${String(n.startDate.month ?? 1).padStart(2, "0")}`
		: null;

const label = (n) => n.title?.english ?? n.title?.romaji ?? n.title?.native;

function shape(n) {
	return {
		anilistId: n.id,
		label: label(n),
		format: n.format,
		isMovie: n.format === "MOVIE",
		episodes: n.episodes ?? null,
		duration: n.duration ?? null,
		startDate: asDate(n),
		averageScore: n.averageScore ?? null,
		posterUrl: n.coverImage?.extraLarge ?? null,
		posterColor: n.coverImage?.color ?? null,
		backdropUrl: n.bannerImage ?? null,
	};
}

// resolves the entry the user actually searched for
async function resolveRoot(nativeTitle, fallbackTitle, year) {
	for (const [search, seasonYear] of [
		[nativeTitle, year],
		[nativeTitle, null],
		[fallbackTitle, year],
	]) {
		if (!search) continue;
		const data = await anilistQuery(RESOLVE, { search, year: seasonYear });
		const media = data?.Page?.media?.[0];
		if (!media) continue;

		const titles = [
			media.title?.romaji,
			media.title?.english,
			media.title?.native,
		];
		if (titleMatches(search, titles)) return media;
	}
	return null;
}

// walks the two nested levels for every anime entry reachable from the root
function collectIds(root) {
	const ids = new Map([[root.id, root]]);
	const keep = (n) => {
		if (n?.type !== "ANIME") return;
		if (![...MAIN_FORMATS, ...SIDE_FORMATS].includes(n.format)) return;
		if (!ids.has(n.id)) ids.set(n.id, n);
	};

	for (const edge of root.relations?.edges ?? []) {
		if (NOISE_RELATIONS.includes(edge.relationType)) continue;
		keep(edge.node);
		// the source manga/novel is the hub -- its relations are the franchise
		for (const inner of edge.node.relations?.edges ?? []) {
			if (NOISE_RELATIONS.includes(inner.relationType)) continue;
			keep(inner.node);
		}
	}
	return ids;
}

// aliased calls get the mutual PREQUEL/SEQUEL/ALTERNATIVE edges
const RELATION_CHUNK = 10;

async function fetchRelations(ids) {
	const list = [...ids];
	const out = {};

	for (let i = 0; i < list.length; i += RELATION_CHUNK) {
		const parts = list.slice(i, i + RELATION_CHUNK).map(
			(id, k) => `a${k}: Media(id: ${Number(id)}) {
				id
				relations { edges { relationType node { id type format } } }
			}`,
		);
		const data = await anilistQuery(`query Batch {${parts.join("\n")}}`);
		for (const key of Object.keys(data ?? {})) {
			const node = data[key];
			if (node) out[node.id] = node;
		}
	}
	return out;
}

// ALTERNATIVE means "same story, different cut"
function groupAlternatives(nodes, mainIds) {
	const parent = new Map([...mainIds].map((id) => [id, id]));
	const find = (x) => {
		while (parent.get(x) !== x) {
			parent.set(x, parent.get(parent.get(x)));
			x = parent.get(x);
		}
		return x;
	};
	const union = (a, b) => {
		const [ra, rb] = [find(a), find(b)];
		if (ra !== rb) parent.set(rb, ra);
	};

	for (const id of mainIds) {
		for (const edge of nodes[id]?.relations?.edges ?? []) {
			if (edge.relationType !== "ALTERNATIVE") continue;
			if (mainIds.has(edge.node.id)) union(id, edge.node.id);
		}
	}

	const groups = new Map();
	for (const id of mainIds) {
		const root = find(id);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root).push(id);
	}
	return groups;
}

// orders the collapsed groups into a linear watch order by following SEQUEL edges
function buildSpine(nodes, groups, rootGroup) {
	const groupOf = new Map();
	for (const [root, members] of groups)
		for (const id of members) groupOf.set(id, root);

	const next = new Map();
	const indegree = new Map([...groups.keys()].map((g) => [g, 0]));
	const neighbours = new Map([...groups.keys()].map((g) => [g, new Set()]));

	for (const [root, members] of groups) {
		for (const id of members) {
			for (const edge of nodes[id]?.relations?.edges ?? []) {
				if (!["SEQUEL", "PREQUEL"].includes(edge.relationType))
					continue;
				const target = groupOf.get(edge.node.id);
				if (target === undefined || target === root) continue;

				neighbours.get(root).add(target);
				neighbours.get(target).add(root);
				if (edge.relationType === "SEQUEL" && !next.has(root)) {
					next.set(root, target);
					indegree.set(target, (indegree.get(target) ?? 0) + 1);
				}
			}
		}
	}

	const primary = (g) => {
		const members = groups
			.get(g)
			.map((id) => nodes[id])
			.filter(Boolean);
		// prefer the episodic cut -- usually newer
		const tv = members.filter((m) => m.format !== "MOVIE");
		return (tv.length ? tv : members).sort(
			(a, z) => sortKey(a) - sortKey(z),
		)[0];
	};

	// the root's connected component
	const connected = new Set([rootGroup]);
	const stack = [rootGroup];
	while (stack.length) {
		for (const n of neighbours.get(stack.pop()) ?? []) {
			if (!connected.has(n)) {
				connected.add(n);
				stack.push(n);
			}
		}
	}

	const starts = [...connected]
		.filter((g) => (indegree.get(g) ?? 0) === 0)
		.sort((a, z) => sortKey(primary(a)) - sortKey(primary(z)));

	const ordered = [];
	const seen = new Set();
	for (const start of starts) {
		let cur = start;
		while (cur !== undefined && !seen.has(cur)) {
			seen.add(cur);
			ordered.push(cur);
			cur = next.get(cur);
		}
	}
	// belong in the order, by release date
	for (const g of [...connected].sort(
		(a, z) => sortKey(primary(a)) - sortKey(primary(z)),
	)) {
		if (!seen.has(g)) {
			seen.add(g);
			ordered.push(g);
		}
	}

	const orphans = [...groups.keys()]
		.filter((g) => !connected.has(g))
		.sort((a, z) => sortKey(primary(a)) - sortKey(primary(z)));

	return { ordered, orphans, primary };
}

// "Shingeki no Kyojin Season 3 Part 2" -> "3.2", "Sousou no Frieren 2nd Season" -> "2"
function numberFromTitle(title) {
	if (!title) return null;
	const season =
		title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ??
		title.match(/\bseason\s+(\d+)\b/i);
	if (!season) return null;
	const part = title.match(/\bpart\s+(\d+)\b/i);
	return part ? `${season[1]}.${part[1]}` : season[1];
}

// zip ep counts
function numberByZip(slots, tmdbSeasons) {
	const episodic = slots.filter((s) => !s.isMovie);
	if (!episodic.length || !tmdbSeasons?.length) return false;

	let i = 0;
	for (const season of tmdbSeasons) {
		const bucket = [];
		let sum = 0;
		while (i < episodic.length && sum < season.episode_count) {
			if (episodic[i].episodes == null) return false;
			sum += episodic[i].episodes;
			bucket.push(episodic[i]);
			i++;
		}
		if (sum !== season.episode_count || !bucket.length) return false;
		bucket.forEach((slot, k) => {
			slot.number =
				bucket.length > 1
					? `${season.season_number}.${k + 1}`
					: `${season.season_number}`;
		});
	}
	// unreleased entries have no TMDB counterpart -- number them off the end
	let trailing = tmdbSeasons.length;
	for (; i < episodic.length; i++) episodic[i].number = String(++trailing);
	return true;
}

function applyNumbers(slots, tmdbSeasons) {
	const zipped = numberByZip(slots, tmdbSeasons);
	if (!zipped) {
		let n = 0;
		for (const slot of slots) if (!slot.isMovie) slot.number = String(++n);
	}

	// an explicit season number in the title beats the zip
	const base = (n) => String(n ?? "").split(".")[0];
	for (const slot of slots) {
		const fromTitle = numberFromTitle(slot.label);
		if (!fromTitle) continue;
		if (!slot.number || base(fromTitle) !== base(slot.number)) {
			slot.number = fromTitle;
		}
	}

	// "3.1" with no sibling "3.2" is just "3"
	const counts = new Map();
	for (const slot of slots) {
		const base = slot.number?.split(".")[0];
		if (base) counts.set(base, (counts.get(base) ?? 0) + 1);
	}
	for (const slot of slots) {
		if (
			slot.number?.includes(".") &&
			counts.get(slot.number.split(".")[0]) === 1
		) {
			slot.number = slot.number.split(".")[0];
		}
	}
}

export async function buildAnimeChain({
	nativeTitle,
	fallbackTitle,
	year,
	tmdbSeasons,
}) {
	const root = await resolveRoot(nativeTitle, fallbackTitle, year);
	if (!root) return null;

	const discovered = collectIds(root);

	// only main-format entries can enter the spine
	const isShortForm = (n) => n.format === "ONA" && n.episodes === 1;

	const mainIds = new Set(
		[...discovered.values()]
			.filter((n) => MAIN_FORMATS.includes(n.format) && !isShortForm(n))
			.map((n) => n.id),
	);
	mainIds.add(root.id);

	const edges = await fetchRelations(mainIds);
	const nodes = {};
	for (const [id, node] of discovered) {
		nodes[id] = {
			...node,
			relations: edges[id]?.relations ?? node.relations,
		};
	}

	const groups = groupAlternatives(nodes, mainIds);
	const rootGroup = [...groups.keys()].find((g) =>
		groups.get(g).includes(root.id),
	);
	const { ordered, orphans, primary } = buildSpine(nodes, groups, rootGroup);

	const slots = ordered.map((group, index) => {
		const lead = primary(group);
		const others = groups
			.get(group)
			.filter((id) => id !== lead.id)
			.map((id) => shape(nodes[id]));
		return {
			// slots are a superset of the tmdb season shape on purpose
			season_number: index + 1,
			episode_count: lead.episodes ?? 0,
			...shape(lead),
			number: null,
			variants: others,
		};
	});
	applyNumbers(slots, tmdbSeasons);

	// the manga/novel the anime adapts
	const sourceEdges = (root.relations?.edges ?? []).filter(
		(e) => e.relationType === "ADAPTATION" && e.node.type === "MANGA",
	);
	const sourceEdge =
		sourceEdges.find((e) => e.node.format === "MANGA") ?? sourceEdges[0];

	// ovas/specials plus anything that never joined the root's chain -- recap
	// films, non-canon movies, spin-off shorts.
	const orphanIds = new Set(orphans.flatMap((g) => groups.get(g)));

	// anchored to the slot they aired after
	const anchors = slots
		.filter((s) => s.startDate)
		.map((s) => ({
			afterSlot: s.number,
			afterSlotAnilistId: s.anilistId,
			date: s.startDate,
		}))
		.sort((a, z) => a.date.localeCompare(z.date));

	const anchorFor = (node) => {
		const date = asDate(node);
		if (!date) return { afterSlot: null, afterSlotAnilistId: null };
		let hit = null;
		for (const a of anchors) if (a.date <= date) hit = a;
		return {
			afterSlot: hit?.afterSlot ?? null,
			afterSlotAnilistId: hit?.afterSlotAnilistId ?? null,
		};
	};

	const sideStories = Object.values(nodes)
		.filter((n) => SIDE_FORMATS.includes(n.format) || orphanIds.has(n.id))
		.sort((a, z) => sortKey(a) - sortKey(z))
		.map((n) => ({ ...shape(n), ...anchorFor(n) }));

	return {
		anilistId: root.id,
		titleRomaji: root.title?.romaji ?? null,
		titleNative: root.title?.native ?? null,
		communityScore: root.averageScore ?? null,
		sourceMedia: sourceEdge
			? {
					anilistId: sourceEdge.node.id,
					format: sourceEdge.node.format,
					label: label(sourceEdge.node),
				}
			: null,
		slots,
		sideStories,
	};
}
