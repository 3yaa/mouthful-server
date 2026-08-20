import { anilistQuery, titleMatches } from "./anilistClient.js";

// TMDB's only job is deciding whether to run at all
const TMDB_ANIME_KEYWORD = 210024;
const TMDB_ANIMATION_GENRE = 16;
const ANIME_ORIGINS = ["JP", "CN", "KR", "TW"];

// donghua are almost always ONA
const MAIN_FORMATS = ["TV", "ONA", "MOVIE"];
// promo shorts, tie-ins and character pages -- delete
const NOISE_RELATIONS = ["CHARACTER", "OTHER", "SPIN_OFF", "SUMMARY"];
const SIDE_FORMATS = ["OVA", "SPECIAL", "TV_SHORT"];

const SLOT_FORMATS = [...MAIN_FORMATS, ...SIDE_FORMATS];

// genre+origin
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

// studios ride along per entry: the production house genuinely changes between
// seasons, which is the whole reason metadata is stored per slot
const MEDIA_FIELDS = `
	id type format episodes duration status averageScore
	title { romaji english native }
	startDate { year month }
	endDate { year month }
	studios { edges { isMain node { name } } }
	coverImage { extraLarge color }
`;

// Discovery only needs enough to decide whether an id is worth fetching. The
// full record arrives in the batch below, so the walk stays cheap even three
// levels deep.
const REL_NODE = `id type format`;

// Two levels, not three: AniList answers a third nested `relations` with an
// empty edge list every time, so asking for it only spent query complexity.
// What lives out there is reached by growPrints and growSpine instead.
const ROOT_FRAGMENT = `fragment Root on Media {
	${MEDIA_FIELDS}
	relations { edges { relationType node {
		${REL_NODE}
		relations { edges { relationType node { ${REL_NODE} } } }
	} } }
}`;

// The fallback search variants go out as aliases in one query instead of up to
// three sequential round trips. A miss used to cost three; now it costs one.
// Built dynamically because a null `search` is not "no search" to AniList -- it
// drops the filter and returns arbitrary popular media.
function resolveQuery(variants) {
	const params = variants
		.map((v, i) => `$s${i}: String!${v.year ? `, $y${i}: Int` : ""}`)
		.join(", ");
	const aliases = variants.map(
		(v, i) => `v${i}: Page(perPage: 1) {
			media(
				type: ANIME
				search: $s${i}${v.year ? `\n\t\t\t\tseasonYear: $y${i}` : ""}
				sort: SEARCH_MATCH
			) { ...Root }
		}`,
	);
	return `query Resolve(${params}) {\n${aliases.join("\n")}\n}\n${ROOT_FRAGMENT}`;
}

// Page.perPage caps at 50. id_in takes the whole chunk in one non-aliased
// query, which is both fewer round trips and less query complexity than
// aliased Media(id:) batches.
const NODE_CHUNK = 50;

const NODES = `query Nodes($ids: [Int]) {
	Page(perPage: ${NODE_CHUNK}) {
		media(id_in: $ids) {
			${MEDIA_FIELDS}
			relations { edges { relationType node { ${REL_NODE} } } }
		}
	}
}`;

// Entity-level cache. anilistQuery caches whole queries, which never hits
// across two shows in the same franchise; this does. Nothing downstream
// mutates a node -- shape() and the slot builders construct fresh objects --
// so handing out the cached reference is safe.
const NODE_TTL = 12 * 60 * 60 * 1000;
const NODE_CACHE_MAX = 2000;
const nodeCache = new Map();

async function fetchNodes(ids) {
	const out = {};
	const wanted = new Set();
	const now = Date.now();

	for (const raw of ids) {
		const id = Number(raw);
		if (!Number.isFinite(id)) continue;
		const hit = nodeCache.get(id);
		if (hit && hit.expires > now) out[id] = hit.node;
		else wanted.add(id);
	}

	// sorted so chunk boundaries are stable between requests and anilistQuery's
	// cache key can actually hit
	const list = [...wanted].sort((a, z) => a - z);

	const chunks = [];
	for (let i = 0; i < list.length; i += NODE_CHUNK)
		chunks.push(list.slice(i, i + NODE_CHUNK));

	// in flight together: the limiter in anilistClient serialises slot-taking,
	// not the fetch, so these genuinely overlap
	const pages = await Promise.all(
		chunks.map((ids) => anilistQuery(NODES, { ids })),
	);

	for (const data of pages) {
		for (const node of data?.Page?.media ?? []) {
			out[node.id] = node;
			nodeCache.set(node.id, { node, expires: Date.now() + NODE_TTL });
		}
	}

	if (nodeCache.size > NODE_CACHE_MAX) {
		const cutoff = Date.now();
		for (const [k, v] of nodeCache)
			if (v.expires <= cutoff) nodeCache.delete(k);
	}
	return out;
}

// AniList cannot tell a feature-length special that TMDB stocks as a film from
// one it does not. Hajime no Ippo's "Champion Road" and Attack on Titan's "THE
// FINAL CHAPTERS" have identical records down to the edge types -- PREQUEL to
// the series, SEQUEL to the next entry, ADAPTATION to the manga, 90 and 85
// minutes -- and TMDB carries the first as a movie and has never heard of the
// second. So ask TMDB, because nothing else can answer.
//
// A film row hands over to the movies list, so promoting something TMDB has no
// entry for can only ever end in "Could Not Find Movie".
const TMDB_YEAR_SLACK = 1;

async function tmdbMovieFor(title, year) {
	const key = process.env.TMDB_API_KEY;
	// no year to check against means no way to reject a bad top hit, and a
	// wrong film is worse than a side story
	if (!key || !title || !year) return null;

	const url =
		`https://api.themoviedb.org/3/search/movie?api_key=${key}` +
		`&query=${encodeURIComponent(title)}`;
	const res = await fetch(url);
	if (!res.ok) return null;

	const { results } = await res.json();
	// TMDB has already done the fuzzy matching -- "Champion Road" comes back
	// under its english release title, "Fighting Spirit: Champion Road", which
	// no string comparison against the anilist label would accept. The release
	// year is what guards against an unrelated top hit.
	const hit = (results ?? []).find((r) => {
		const released = Number(r.release_date?.slice(0, 4));
		return released && Math.abs(released - year) <= TMDB_YEAR_SLACK;
	});
	return hit ? { id: hit.id, title: null } : null;
}

// The label search only works when the two sides call the film the same thing,
// and sometimes there is no such name. AniList has no entry for Attack on
// Titan's theatrical finale at all: it knows the two broadcast specials, TMDB
// knows only the film that compiles them, and it is called "THE LAST ATTACK" --
// nothing derived from "THE FINAL CHAPTERS Special 2" ever reaches that.
//
// What does bridge them is the franchise and the date. Search the show's own
// title and take an animated film released within a year of the special. The
// genre filter is load-bearing: the same search returns two live-action Attack
// on Titan films and a stage musical, one of which is dated inside the window.
async function tmdbFranchiseFilm(showTitle, year) {
	const key = process.env.TMDB_API_KEY;
	if (!key || !showTitle || !year) return null;

	const url =
		`https://api.themoviedb.org/3/search/movie?api_key=${key}` +
		`&query=${encodeURIComponent(showTitle)}`;
	const res = await fetch(url);
	if (!res.ok) return null;

	const { results } = await res.json();
	const hit = (results ?? [])
		.filter((r) => {
			if (!r.genre_ids?.includes(TMDB_ANIMATION_GENRE)) return false;
			const released = Number(r.release_date?.slice(0, 4));
			return released && Math.abs(released - year) <= TMDB_YEAR_SLACK;
		})
		.sort((a, z) => a.release_date.localeCompare(z.release_date))[0];
	// the title comes back too: the row has to say what it would open, and the
	// special's own name is not it
	return hit ? { id: hit.id, title: hit.title } : null;
}

const fuzzy = (d) =>
	d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, "0")}` : null;

const sortKey = (n) =>
	(n.startDate?.year ?? 9999) * 100 + (n.startDate?.month ?? 1);

const label = (n) => n.title?.english ?? n.title?.romaji ?? n.title?.native;

const mainStudio = (n) => {
	const edges = n?.studios?.edges ?? [];
	return (edges.find((e) => e.isMain) ?? edges[0])?.node?.name ?? null;
};

const totalMinutes = (n) => (n?.episodes ?? 1) * (n?.duration ?? 0);

// AniList's MediaFormat, narrowed to the union the client declares
const FORMATS = new Set(["TV", "TV_SHORT", "ONA", "MOVIE", "OVA", "SPECIAL"]);
const animeFormat = (f) => (FORMATS.has(f) ? f : "UNKNOWN");

function shape(n) {
	return {
		anilistId: n.id,
		label: label(n),
		format: animeFormat(n.format),
		isMovie: n.format === "MOVIE",
		episodes: n.episodes ?? null,
		duration: n.duration ?? null,
		status: n.status ?? null,
		startDate: fuzzy(n.startDate),
		endDate: fuzzy(n.endDate),
		studio: mainStudio(n),
		posterUrl: n.coverImage?.extraLarge ?? null,
		posterColor: n.coverImage?.color ?? null,
	};
}

// films and side stories, per AnimeExtraProps. averageScore lives here rather
// than on slots: anilist_meta is display-only, so a stale community score is
// harmless, while a slot carrying one invites sorting on it.
const extraShape = (n) => ({
	anilistId: n.id,
	label: label(n),
	format: animeFormat(n.format),
	episodes: n.episodes ?? null,
	duration: n.duration ?? null,
	startDate: fuzzy(n.startDate),
	averageScore: n.averageScore ?? null,
	posterUrl: n.coverImage?.extraLarge ?? null,
	posterColor: n.coverImage?.color ?? null,
});

// resolves the entry the user actually searched for
async function resolveRoot(nativeTitle, fallbackTitle, year) {
	const variants = [];
	// normalised: an undefined year and a null year are the same query, and the
	// dedupe below compares by value
	const y = year ?? null;
	for (const v of [
		{ search: nativeTitle, year: y },
		{ search: nativeTitle, year: null },
		{ search: fallbackTitle, year: y },
	]) {
		if (!v.search) continue;
		// original_name and name are the same string on most English-titled
		// shows, and a missing year collapses the first pair
		if (variants.some((x) => x.search === v.search && x.year === v.year))
			continue;
		variants.push(v);
	}
	if (!variants.length) return null;

	const variables = {};
	variants.forEach((v, i) => {
		variables[`s${i}`] = v.search;
		if (v.year) variables[`y${i}`] = v.year;
	});

	const data = await anilistQuery(resolveQuery(variants), variables);

	// same precedence the sequential fallback chain had
	for (let i = 0; i < variants.length; i++) {
		const media = data?.[`v${i}`]?.media?.[0];
		if (!media) continue;
		const titles = [
			media.title?.romaji,
			media.title?.english,
			media.title?.native,
		];
		if (titleMatches(variants[i].search, titles)) return media;
	}
	return null;
}

// Walks three levels out from the root and returns bare ids -- the batch fetch
// supplies the metadata. Print works come back separately: they are needed for
// sourceMedia's title, but must never reach the slot/film/side-story passes,
// which iterate every anime node.
function collectIds(root) {
	const ids = new Set([root.id]);
	const sources = new Set();

	const keep = (n) => {
		if (!n) return;
		// tie-in novels and spin-off manga are not entries in their own right,
		// but films hang off them
		if (n.type === "MANGA") return void sources.add(n.id);
		if (n.type !== "ANIME") return;
		if (!SLOT_FORMATS.includes(n.format)) return;
		ids.add(n.id);
	};

	for (const edge of root.relations?.edges ?? []) {
		if (NOISE_RELATIONS.includes(edge.relationType)) continue;
		keep(edge.node);
		// the source manga/novel is the hub -- its relations are the franchise
		for (const inner of edge.node?.relations?.edges ?? []) {
			if (NOISE_RELATIONS.includes(inner.relationType)) continue;
			keep(inner.node);

			// My Hero Academia's films are not children of the manga at all.
			// Each has a light-novel tie-in hanging off the manga, and the film
			// hangs off that:
			//
			//   manga -> SIDE_STORY -> "THE MOVIE: Futari no Hero" (NOVEL)
			//         -> ADAPTATION -> film
			//
			// AniList answers the third level of `relations` in a single query
			// with an empty edge list, so there is nothing to walk here -- the
			// novel is recorded as a source above and growPrints picks the film
			// up off the batched record, where the edges are actually present.
		}
	}
	return { ids, sources };
}

// The films that hang off a tie-in novel rather than off the show. collectIds
// cannot reach them -- AniList truncates `relations` past the second level of
// one query -- but the print works themselves were fetched as top-level records
// in the same batch, and those do carry their edges.
async function growPrints(nodes, prints) {
	const wanted = new Set();
	for (const print of Object.values(prints)) {
		for (const edge of print.relations?.edges ?? []) {
			if (NOISE_RELATIONS.includes(edge.relationType)) continue;
			const n = edge.node;
			if (n?.type !== "ANIME") continue;
			if (!SLOT_FORMATS.includes(n.format)) continue;
			if (!nodes[n.id]) wanted.add(n.id);
		}
	}
	if (!wanted.size) return;

	const fetched = await fetchNodes(wanted);
	for (const node of Object.values(fetched)) {
		if (node.type === "ANIME") nodes[node.id] = node;
	}
}

// Side stories hang off the season they belong to rather than off the root:
// My Hero Academia's rescue-training OVA is a SIDE_STORY of season 1 and its
// OVAs are SIDE_STORYs of season 5, so the sequel walk never saw any of them
// and the show came back with two side entries instead of eight. One round,
// from entries already on the chain -- recursing would leave the franchise
// through the first crossover it meets.
async function growSides(nodes) {
	const wanted = new Set();
	for (const node of Object.values(nodes)) {
		for (const edge of node.relations?.edges ?? []) {
			if (edge.relationType !== "SIDE_STORY") continue;
			const n = edge.node;
			if (n?.type !== "ANIME") continue;
			if (!SLOT_FORMATS.includes(n.format)) continue;
			if (!nodes[n.id]) wanted.add(n.id);
		}
	}
	if (!wanted.size) return;

	const fetched = await fetchNodes(wanted);
	for (const node of Object.values(fetched)) {
		if (node.type === "ANIME") nodes[node.id] = node;
	}
}

// Long-running franchises outrun the initial walk. Every JoJo part adapts a
// different manga, so Diamond is Unbreakable hangs off a volume the root has
// never heard of -- discovery stopped at the Egypt arc and the show came back
// with 3 of its 6 seasons. Follow the sequel chain outward instead, until it
// stops turning up entries we have not already seen.
const MAX_SPINE_ROUNDS = 6;

async function growSpine(nodes) {
	// ids AniList declined to return once will decline again -- without this a
	// single deleted entry costs a fetch on every remaining round
	const attempted = new Set(Object.keys(nodes).map(Number));

	for (let round = 0; round < MAX_SPINE_ROUNDS; round++) {
		const missing = new Set();
		for (const id of Object.keys(nodes)) {
			for (const edge of nodes[id]?.relations?.edges ?? []) {
				if (!["SEQUEL", "PREQUEL"].includes(edge.relationType))
					continue;
				const n = edge.node;
				// any anime format, not just the ones that can become slots:
				// Hajime no Ippo runs 2000 series -> Champion Road (special)
				// -> Mashiba vs Kimura (ova) -> New Challenger, so stopping at
				// non-main formats cut the franchise in half.
				if (n?.type !== "ANIME") continue;
				if (attempted.has(n.id)) continue;
				if (!nodes[n.id]?.relations) missing.add(n.id);
			}
		}
		if (!missing.size) return;

		for (const id of missing) attempted.add(id);
		const fetched = await fetchNodes(missing);
		for (const node of Object.values(fetched)) {
			if (node.type === "ANIME") nodes[node.id] = node;
		}
	}
}

// ALTERNATIVE covers two different things and only one of them should collapse.
//
//   FMA 2003 vs Brotherhood     6 years apart, 1224 vs 1536 min   -> two rows
//   HxH 1999 vs 2011            12 years apart                    -> two rows
//   Madoka TV vs the films      1 year apart, TV vs MOVIE         -> one slot
//   a trimmed broadcast recut   same year, ~60% runtime            -> one slot
//
// A remake is a fresh production years later, and the user finds it by entering
// its year -- it deserves its own show record with its own progress and score.
// A recut ships alongside what it recuts and condenses it.
const REMAKE_GAP_YEARS = 4;
const RECUT_RUNTIME_RATIO = 0.6;

function isSameProduction(a, b) {
	if (!a || !b) return false;
	const ya = a.startDate?.year;
	const yb = b.startDate?.year;
	// unknown date -> assume remake and keep them apart
	if (!ya || !yb) return false;
	if (Math.abs(ya - yb) > REMAKE_GAP_YEARS) return false;

	// a film against an episodic run is the compilation case
	if ((a.format === "MOVIE") !== (b.format === "MOVIE")) return true;

	// close in time but comparable in scale is still two full productions
	const [short, long] = [totalMinutes(a), totalMinutes(b)].sort(
		(x, z) => x - z,
	);
	return long ? short / long <= RECUT_RUNTIME_RATIO : false;
}

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
			if (!mainIds.has(edge.node.id)) continue;
			if (!isSameProduction(nodes[id], nodes[edge.node.id])) continue;
			union(id, edge.node.id);
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

// Which entries sit on the root's chain, walking PREQUEL/SEQUEL through every
// anime node rather than only slot-eligible ones. A special sitting between two
// seasons would otherwise cut the franchise in half.
function reachableFrom(nodes, rootId) {
	const seen = new Set([rootId]);
	const stack = [rootId];
	while (stack.length) {
		for (const edge of nodes[stack.pop()]?.relations?.edges ?? []) {
			if (!["SEQUEL", "PREQUEL"].includes(edge.relationType)) continue;
			const n = edge.node;
			if (n?.type !== "ANIME" || seen.has(n.id) || !nodes[n.id]) continue;
			seen.add(n.id);
			stack.push(n.id);
		}
	}
	return seen;
}

function buildSpine(nodes, groups, rootGroup, reachable) {
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

	// every multi-member group is now a production and its own recut, so the
	// lead is the fullest cut -- a 12-episode run leads its 2-hour compilation
	const primary = (g) => {
		const members = groups
			.get(g)
			.map((id) => nodes[id])
			.filter(Boolean);
		const tv = members.filter((m) => m.format !== "MOVIE");
		const pool = tv.length ? tv : members;
		return [...pool].sort(
			(a, z) =>
				totalMinutes(z) - totalMinutes(a) || sortKey(a) - sortKey(z),
		)[0];
	};

	// the root's connected component, seeded with everything the wider walk
	// reached so a chain that runs through a special still counts as one
	const connected = new Set([rootGroup]);
	for (const [group, members] of groups)
		if (members.some((id) => reachable.has(id))) connected.add(group);

	const stack = [...connected];
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
	// anything in the component the sequel chain never threaded, by release date
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

// "Shingeki no Kyojin Season 3 Part 2" -> { season: 3, part: 2 }
// "Sousou no Frieren 2nd Season"        -> { season: 2, part: null }
// "... Final Season Part 2"             -> { season: null, part: 2 }
function numbersFromTitle(title) {
	if (!title) return { season: null, part: null };
	const season =
		title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ??
		title.match(/\bseason\s+(\d+)\b/i);
	// cour is the same idea under a different word, and a bare "Part 2" is how
	// a split season is labelled when it has a name instead of a number
	const part =
		title.match(/\bpart\s+(\d+)\b/i) ??
		title.match(/\b(\d+)(?:st|nd|rd|th)\s+cour\b/i) ??
		title.match(/\bcour\s+(\d+)\b/i);
	return {
		season: season ? Number(season[1]) : null,
		part: part ? Number(part[1]) : null,
	};
}

// Numbering is spine position, corrected by what the entries call themselves.
//
// A split cour is not a season of its own. "Final Season" and "Final Season
// Part 2" are one season in two parts, and counting them as 5 and 6 turned a
// four-season franchise into a six-season one:
//
//   before   1  2  3  3.2  5  6      <- 4 never appears, 5/6 are one season
//   after    1  2  3-1 3-2 4-1 4-2
//
// Parts are written 4-1, not 4.1: a decimal reads as a version number, and
// "3.10" would sort before "3.2".
function applyNumbers(slots) {
	const parsed = slots.map((slot) => numbersFromTitle(slot.label));
	let season = 0;
	let part = 1;

	slots.forEach((slot, i) => {
		const { season: fromTitle, part: partNo } = parsed[i];
		// a part past the first continues the season before it; anything else
		// opens a new one. An explicit season number still wins, and the
		// counter resyncs to it so everything after follows on.
		const continues =
			i > 0 &&
			partNo !== null &&
			partNo > 1 &&
			(fromTitle === null || fromTitle === season);

		if (continues) {
			part = partNo;
		} else {
			season = fromTitle ?? season + 1;
			part = partNo ?? 1;
		}
		slot.seasonNo = season;
		slot.partNo = part;
	});

	// the suffix only earns its place when there is another part to tell this
	// one apart from -- a season nothing else shares is just its number
	const members = new Map();
	for (const slot of slots)
		members.set(slot.seasonNo, (members.get(slot.seasonNo) ?? 0) + 1);

	for (const slot of slots) {
		slot.number =
			members.get(slot.seasonNo) > 1
				? `${slot.seasonNo}-${slot.partNo}`
				: String(slot.seasonNo);
		// working state -- `number` carries everything downstream needs, and
		// these would otherwise be persisted into the seasons jsonb
		delete slot.seasonNo;
		delete slot.partNo;
	}
}

async function buildChain({ nativeTitle, fallbackTitle, year }) {
	const root = await resolveRoot(nativeTitle, fallbackTitle, year);
	if (!root) return null;

	// One batch covers the entire discovered graph -- relations included, so
	// there is no separate pass for edges and none for the print works films
	// hang off.
	const { ids, sources } = collectIds(root);
	const fetched = await fetchNodes([...ids, ...sources]);

	const nodes = {};
	const prints = {};
	for (const node of Object.values(fetched)) {
		if (node.type === "ANIME") nodes[node.id] = node;
		else prints[node.id] = node;
	}
	// if AniList did not return the root, fall back to the resolve payload
	nodes[root.id] ??= root;

	// print works first: a film reached this way still needs growSpine to pull
	// in whatever sits on its own sequel chain
	await growPrints(nodes, prints);
	await growSpine(nodes);
	// last: what these turn up is optional viewing, and running it before the
	// spine would let a side entry's own sequels grow the chain
	await growSides(nodes);

	// Only main-format entries can enter the spine. This runs after the batch
	// because isShortForm needs the episode count, which discovery does not
	// carry.
	const isShortForm = (n) => n.format === "ONA" && n.episodes === 1;

	const mainIds = new Set(
		Object.values(nodes)
			.filter((n) => MAIN_FORMATS.includes(n.format) && !isShortForm(n))
			.map((n) => n.id),
	);
	mainIds.add(root.id);

	const groups = groupAlternatives(nodes, mainIds);
	const rootGroup = [...groups.keys()].find((g) =>
		groups.get(g).includes(root.id),
	);
	const reachable = reachableFrom(nodes, root.id);
	const { ordered, orphans, primary } = buildSpine(
		nodes,
		groups,
		rootGroup,
		reachable,
	);

	const slots = ordered.map((group) => {
		const lead = primary(group);
		const others = groups
			.get(group)
			.filter((id) => id !== lead.id)
			.map((id) => ({
				...shape(nodes[id]),
				variantKind: "alternate_cut",
			}));
		// slots stay a superset of the tmdb season shape on purpose: progress
		// bars, pickers and calcCurProgress read season_number/episode_count and
		// must keep working for anime rows untouched
		return {
			season_number: 0,
			episode_count: lead.episodes ?? 0,
			...shape(lead),
			number: null,
			position: 0,
			variants: others,
		};
	});

	// the manga/novel the anime adapts. The edge is skinny now, so the title
	// comes from the batched print record.
	const sourceEdges = (nodes[root.id]?.relations?.edges ?? []).filter(
		(e) => e.relationType === "ADAPTATION" && e.node?.type === "MANGA",
	);
	const sourceEdge =
		sourceEdges.find((e) => e.node.format === "MANGA") ?? sourceEdges[0];
	const sourceNode = sourceEdge
		? (prints[sourceEdge.node.id] ?? sourceEdge.node)
		: null;
	const sourceId = sourceEdge?.node?.id;

	// Long enough to be a production in its own right rather than a short.
	// Only isRecap uses this: a recap compiles a whole season, so a 20-minute
	// OVA is never one however its edges are shaped.
	const FEATURE_MINUTES = 45;
	const isFeature = (n) =>
		n?.format === "MOVIE" ||
		(["SPECIAL", "OVA"].includes(n?.format) &&
			(n?.duration ?? 0) >= FEATURE_MINUTES &&
			(n?.episodes ?? 1) <= 1);

	// A recap compiles episodes rather than telling its own story, so it hangs
	// off the seasons it covers (PARENT) and adapts nothing. An original film
	// adapts a print work -- every My Hero Academia film has a tie-in novel --
	// and those also carry PARENT to mark the season they sit alongside, so
	// PARENT on its own is not the signal. Having no source is.
	//
	//   ~Chronicle~        PARENT x4, no adaptation          -> recap
	//   Roar of Awakening  PARENT -> S2, no adaptation       -> recap
	//   Two Heroes         PARENT -> S3, ADAPTATION -> novel -> keep
	//   Infinity Castle    no PARENT at all                  -> keep
	const isRecap = (n) => {
		// A recap has to be big enough to be one. My Hero Academia's rescue
		// training OVA is 27 minutes with a PARENT edge to season 1 and no
		// source of its own, which is the recap shape exactly -- it was being
		// folded into season 1 as a variant and vanishing from the UI. Nothing
		// under feature length compiles a season.
		if (!isFeature(n)) return false;
		const edges = n?.relations?.edges ?? [];
		const compiles = edges.some(
			(e) => e.relationType === "PARENT" && e.node?.type === "ANIME",
		);
		if (!compiles) return false;
		// both recaps and original films adapt something, so what they adapt is
		// the tell: a recap points at the show's own source, an original film
		// at a tie-in written for it.
		const ownSource = edges.some(
			(e) =>
				e.relationType === "ADAPTATION" &&
				e.node?.type === "MANGA" &&
				e.node.id !== sourceId,
		);
		return !ownSource;
	};

	// Films leave the slot array entirely. A film is watched in one sitting and
	// scored in the movies list, so it is not a position the episode stepper
	// should ever land on -- it is a pointer that says "this comes next, open it
	// over there". Slots stay purely episodic.
	const movieSlots = slots.filter((s) => s.isMovie);
	const episodic = slots.filter((s) => !s.isMovie);
	slots.length = 0;
	slots.push(...episodic);
	applyNumbers(slots);
	slots.forEach((s, i) => {
		s.position = i + 1;
		s.season_number = i + 1;
	});

	// A recap of one specific season belongs to that season -- it is an
	// alternate way to watch it. A retrospective spanning four seasons belongs
	// to the franchise and stays in side stories.
	const slotById = new Map(slots.map((s) => [s.anilistId, s]));
	const attached = new Set();

	for (const node of Object.values(nodes)) {
		if (slotById.has(node.id) || !isRecap(node)) continue;
		const parents = [
			...new Set(
				(node.relations?.edges ?? [])
					.filter(
						(e) =>
							e.relationType === "PARENT" &&
							e.node?.type === "ANIME",
					)
					.map((e) => e.node.id),
			),
		].filter((id) => slotById.has(id));
		if (parents.length !== 1) continue;

		slotById.get(parents[0]).variants.push({
			...shape(node),
			variantKind: node.format === "MOVIE" ? "compilation_film" : "recap",
		});
		attached.add(node.id);
	}

	const orphanIds = new Set(orphans.flatMap((g) => groups.get(g)));

	// Feature length but not something AniList calls a MOVIE: these are the only
	// entries whose classification is in doubt, so they are the only ones worth
	// a TMDB call. A handful per franchise, and the whole chain is cached for a
	// week behind them.
	const promotable = Object.values(nodes).filter(
		(n) =>
			isFeature(n) &&
			n.format !== "MOVIE" &&
			!attached.has(n.id) &&
			!isRecap(n),
	);
	const resolved = await Promise.all(
		promotable.map(async (n) => {
			// the entry's own air year, not the show's
			const airedYear = n.startDate?.year;
			// tmdb's english name for the show searches better than the native
			// one; either beats nothing
			const franchise = fallbackTitle ?? nativeTitle;
			try {
				const direct = await tmdbMovieFor(label(n), airedYear);
				return [
					n.id,
					direct ??
						(await tmdbFranchiseFilm(franchise, airedYear)),
				];
			} catch {
				// a blip must not silently reshape the chain -- unresolved
				// falls through to side stories, which promise nothing
				return [n.id, null];
			}
		}),
	);

	// One theatrical cut can compile several broadcast specials -- both halves
	// of Attack on Titan's finale land on THE LAST ATTACK. Keep the entry
	// nearest the film's own release and let the rest stay side stories, so the
	// rail offers the film once rather than twice over.
	const winners = new Map();
	for (const [anilistId, hit] of resolved) {
		if (!hit) continue;
		const held = winners.get(hit.id);
		if (!held || sortKey(nodes[anilistId]) > sortKey(nodes[held.anilistId]))
			winners.set(hit.id, { anilistId, ...hit });
	}
	const promoted = new Map(
		[...winners.values()].map((hit) => [hit.anilistId, hit]),
	);

	// An entry AniList already calls a MOVIE stays a film whether or not TMDB
	// has caught up: an announced sequel with no listing yet is still a film.
	// Everything else has to earn it.
	const filmNodes = [
		...promotable.filter((n) => promoted.has(n.id)),
		...[...orphanIds]
			.map((id) => nodes[id])
			.filter((n) => n?.format === "MOVIE"),
		...movieSlots,
	].filter((n) => {
		const id = n.anilistId ?? n.id;
		if (attached.has(id)) return false;
		return !isRecap(nodes[id] ?? n);
	});
	const filmIds = new Set(filmNodes.map((f) => f.anilistId ?? f.id));
	for (const id of filmIds) orphanIds.delete(id);

	// anchored to the slot they aired after, by id -- position is recomputed on
	// every rebuild and must never be persisted as a reference
	// afterSlot is the display number and afterSlotAnilistId the durable
	// reference -- the number changes when the spine is rebuilt, the id does not
	const anchors = slots
		.filter((s) => s.startDate)
		.map((s) => ({
			afterSlot: s.number,
			afterSlotAnilistId: s.anilistId,
			date: s.startDate,
		}))
		.sort((a, z) => a.date.localeCompare(z.date));

	const anchorFor = (date) => {
		if (!date) return { afterSlot: null, afterSlotAnilistId: null };
		let hit = null;
		for (const a of anchors) if (a.date <= date) hit = a;
		return {
			afterSlot: hit?.afterSlot ?? null,
			afterSlotAnilistId: hit?.afterSlotAnilistId ?? null,
		};
	};

	const sideStories = Object.values(nodes)
		.filter(
			(n) =>
				!filmIds.has(n.id) &&
				!attached.has(n.id) &&
				(SIDE_FORMATS.includes(n.format) || orphanIds.has(n.id)),
		)
		.sort((a, z) => sortKey(a) - sortKey(z))
		.map((n) => ({ ...extraShape(n), ...anchorFor(fuzzy(n.startDate)) }));

	const films = [...filmIds]
		.map((id) => nodes[id])
		.filter(Boolean)
		.map(extraShape)
		.sort((a, z) =>
			(a.startDate ?? "9999").localeCompare(z.startDate ?? "9999"),
		)
		.map((film) => ({
			...film,
			// set for anything that had to be looked up to get in here, so the
			// hand-off is an id rather than another title guess. null on an
			// entry AniList already called a movie -- handleOpenFilm falls back
			// to matching on title for those.
			tmdbMovieId: promoted.get(film.anilistId)?.id ?? null,
			// only the franchise fallback carries a title, and it does so
			// because the anilist label names the broadcast special rather than
			// the film the row opens
			label: promoted.get(film.anilistId)?.title ?? film.label,
			...anchorFor(film.startDate),
		}));

	return {
		anilistId: root.id,
		titleRomaji: root.title?.romaji ?? null,
		titleNative: root.title?.native ?? null,
		studio: mainStudio(nodes[root.id] ?? root),
		sourceMedia: sourceNode
			? {
					anilistId: sourceNode.id,
					format: sourceNode.format,
					label: label(sourceNode),
				}
			: null,
		slots,
		films,
		sideStories,
	};
}

// A finished show's relation graph does not move week to week, so a whole
// assembled chain is cacheable far longer than the nodes it was built from.
// This is the optimisation that matters: a repeat open of the same show costs
// zero AniList calls rather than two to four.
//
// In-process only. Multiple workers means a cold cache per worker and a restart
// drops everything -- move this and anilistClient's query cache to Redis if you
// run more than one instance.
const CHAIN_TTL = 7 * 24 * 60 * 60 * 1000;
const CHAIN_CACHE_MAX = 300;
const chainCache = new Map();

export async function buildAnimeChain({
	nativeTitle,
	fallbackTitle,
	year,
	forceRefresh = false,
}) {
	const key = JSON.stringify([
		nativeTitle ?? null,
		fallbackTitle ?? null,
		year ?? null,
	]);
	const hit = chainCache.get(key);
	if (!forceRefresh && hit && hit.expires > Date.now()) {
		// cloned: callers destructure and reassign, and one of them mutating a
		// shared slot array would corrupt every later read
		return structuredClone(hit.chain);
	}

	const chain = await buildChain({ nativeTitle, fallbackTitle, year });
	if (!chain) return null;

	// lets the caller decide when a stored chain is stale enough to rebuild
	chain.chainFetchedAt = new Date().toISOString();
	chainCache.set(key, { chain, expires: Date.now() + CHAIN_TTL });

	if (chainCache.size > CHAIN_CACHE_MAX) {
		const now = Date.now();
		for (const [k, v] of chainCache)
			if (v.expires <= now) chainCache.delete(k);
	}
	return structuredClone(chain);
}
