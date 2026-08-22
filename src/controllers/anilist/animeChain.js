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
// the two edges that carry the franchise forward, as opposed to hanging
// something off it
const SPINE_RELATIONS = ["SEQUEL", "PREQUEL"];

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
// What lives out there is reached by grow() instead.
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

// One request per distinct query string for the life of a build. The
// promotable entries differ by year, but the year filters the response rather
// than parameterising the request, so every entry falling through to the
// franchise fallback was firing the same search and discarding all but one
// copy of the answer. The dedupe has to hold the in-flight promise, not just
// the settled result: the promotion pass starts them all in the same tick.
function tmdbSearcher() {
	const inflight = new Map();

	return (query) => {
		const key = process.env.TMDB_API_KEY;
		if (!key || !query) return Promise.resolve(null);

		const held = inflight.get(query);
		if (held) return held;

		const url =
			`https://api.themoviedb.org/3/search/movie?api_key=${key}` +
			`&query=${encodeURIComponent(query)}`;
		// null for a non-ok response, an array otherwise -- the two cases the
		// callers used to distinguish by returning early out of their own fetch
		const pending = fetch(url).then(async (res) => {
			if (!res.ok) return null;
			const { results } = await res.json();
			return results ?? [];
		});

		inflight.set(query, pending);
		return pending;
	};
}

const releasedWithin = (r, year) => {
	const released = Number(r.release_date?.slice(0, 4));
	return released && Math.abs(released - year) <= TMDB_YEAR_SLACK;
};

async function tmdbMovieFor(search, title, year) {
	// no year to check against means no way to reject a bad top hit, and a
	// wrong film is worse than a side story
	if (!title || !year) return null;

	const results = await search(title);
	if (!results) return null;

	// TMDB has already done the fuzzy matching -- "Champion Road" comes back
	// under its english release title, "Fighting Spirit: Champion Road", which
	// no string comparison against the anilist label would accept. The release
	// year is what guards against an unrelated top hit.
	const hit = results.find((r) => releasedWithin(r, year));
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
async function tmdbFranchiseFilm(search, showTitle, year) {
	if (!showTitle || !year) return null;

	const results = await search(showTitle);
	if (!results) return null;

	const hit = results
		.filter(
			(r) =>
				r.genre_ids?.includes(TMDB_ANIMATION_GENRE) &&
				releasedWithin(r, year),
		)
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
//
// sourceId is the show's own manga, resolved once per graph.
const isRecap = (n, sourceId) => {
	// A recap has to be big enough to be one. My Hero Academia's rescue
	// training OVA is 27 minutes with a PARENT edge to season 1 and no source
	// of its own, which is the recap shape exactly -- it was being folded into
	// season 1 as a variant and vanishing from the UI. Nothing under feature
	// length compiles a season.
	if (!isFeature(n)) return false;
	const edges = n?.relations?.edges ?? [];
	const compiles = edges.some(
		(e) => e.relationType === "PARENT" && e.node?.type === "ANIME",
	);
	if (!compiles) return false;
	// both recaps and original films adapt something, so what they adapt is
	// the tell: a recap points at the show's own source, an original film at a
	// tie-in written for it.
	const ownSource = edges.some(
		(e) =>
			e.relationType === "ADAPTATION" &&
			e.node?.type === "MANGA" &&
			e.node.id !== sourceId,
	);
	return !ownSource;
};

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
			// novel is recorded as a source above and grow() picks the film up
			// off the batched record, where the edges are actually present.
		}
	}
	return { ids, sources };
}

// Growing the graph used to be three passes, each paying its own round trip:
// growPrints for the films that hang off a tie-in novel, growSpine for the
// sequel chain, growSides for the side stories hanging off a season. They want
// different edges off the same records, so a round can ask for all of them at
// once and the whole thing converges in the depth of the sequel chain rather
// than in the sum of the three.
//
// The orderings the passes encoded survive as rules rather than as sequence:
//
//   - Print works seed round zero and nothing after. They gain no edges of
//     their own, and their films are found off the batched print record where
//     the edges are actually present.
//   - A side story does not seed another round. growSides ran last and did not
//     recurse, because following a side entry's own sequels leaves the
//     franchise through the first crossover it meets.
//   - A side story a spine edge later claims graduates and does seed, which is
//     what growSpine would have done had it reached the entry first.
//
// Same cap as growSpine had: it is a safety valve on a cyclic or absurdly deep
// graph, not a limit anything real reaches -- each round expands the entire
// frontier, and collectIds has already covered the first two hops.
const MAX_GROWTH_ROUNDS = 6;

async function grow(nodes, prints) {
	// ids AniList declined to return once will decline again -- without this a
	// single deleted entry costs a fetch on every remaining round
	const attempted = new Set(Object.keys(nodes).map(Number));
	// edges already read off this record
	const scanned = new Set();
	// reached only as somebody's side story: kept, but it does not seed
	const passive = new Set();
	let printSeeds = Object.values(prints);

	const anime = (n) => n?.type === "ANIME";
	const slottable = (n) => anime(n) && SLOT_FORMATS.includes(n.format);
	const unseen = (n) => !nodes[n.id] && !attempted.has(n.id);

	for (let round = 0; round < MAX_GROWTH_ROUNDS; round++) {
		const spineWanted = new Set();
		const sideWanted = new Set();
		let graduated = false;

		for (const print of printSeeds) {
			for (const edge of print.relations?.edges ?? []) {
				if (NOISE_RELATIONS.includes(edge.relationType)) continue;
				const n = edge.node;
				if (slottable(n) && unseen(n)) spineWanted.add(n.id);
			}
		}
		printSeeds = [];

		for (const key of Object.keys(nodes)) {
			const id = Number(key);
			if (scanned.has(id) || passive.has(id)) continue;
			scanned.add(id);

			for (const edge of nodes[key].relations?.edges ?? []) {
				const n = edge.node;

				if (SPINE_RELATIONS.includes(edge.relationType)) {
					// any anime format, not just the ones that can become
					// slots: Hajime no Ippo runs 2000 series -> Champion Road
					// (special) -> Mashiba vs Kimura (ova) -> New Challenger,
					// so stopping at non-main formats cut the franchise in half
					if (!anime(n)) continue;
					if (nodes[n.id]) {
						// already here as a side story, and the spine has now
						// claimed it -- walk it
						if (passive.delete(n.id)) graduated = true;
					} else if (!attempted.has(n.id)) spineWanted.add(n.id);
					continue;
				}

				if (edge.relationType === "SIDE_STORY") {
					// Side stories hang off the season they belong to rather
					// than off the root: My Hero Academia's rescue-training OVA
					// is a SIDE_STORY of season 1 and its OVAs are SIDE_STORYs
					// of season 5, so a walk that only follows the spine came
					// back with two side entries instead of eight.
					if (slottable(n) && unseen(n)) sideWanted.add(n.id);
				}
			}
		}

		// wanted by both rules in the same round is wanted by the stronger one
		for (const id of spineWanted) sideWanted.delete(id);
		const wanted = new Set([...spineWanted, ...sideWanted]);

		if (!wanted.size) {
			// nothing to fetch, but a graduated entry still has edges nobody
			// has read
			if (!graduated) return;
			continue;
		}

		for (const id of wanted) attempted.add(id);
		const fetched = await fetchNodes(wanted);
		for (const node of Object.values(fetched)) {
			if (node.type !== "ANIME") continue;
			nodes[node.id] = node;
			if (sideWanted.has(node.id)) passive.add(node.id);
		}
	}
}

// ALTERNATIVE covers two different things and only one of them should collapse.
//
//   FMA 2003 vs Brotherhood     6 years apart, 1224 vs 1536 min   -> two rows
//   HxH 1999 vs 2011            12 years apart                    -> two rows
//   a trimmed broadcast recut   same year, ~60% runtime            -> one slot
//
// A film against the run it condenses used to collapse here too, as a cut of
// that part. It does not any more -- see isCompilation, which takes it out of
// the graph before grouping ever sees it.
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
			if (!SPINE_RELATIONS.includes(edge.relationType)) continue;
			const n = edge.node;
			if (n?.type !== "ANIME" || seen.has(n.id) || !nodes[n.id]) continue;
			seen.add(n.id);
			stack.push(n.id);
		}
	}
	return seen;
}

function buildSpine(nodes, groups, rootGroup, reachable, preferred) {
	const groupOf = new Map();
	for (const [root, members] of groups)
		for (const id of members) groupOf.set(id, root);

	const next = new Map();
	const indegree = new Map([...groups.keys()].map((g) => [g, 0]));
	const neighbours = new Map([...groups.keys()].map((g) => [g, new Set()]));

	for (const [root, members] of groups) {
		for (const id of members) {
			for (const edge of nodes[id]?.relations?.edges ?? []) {
				if (!SPINE_RELATIONS.includes(edge.relationType)) continue;
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
		// An explicit pick wins outright. Saying "I watched the film" is a
		// statement about which cut of this part you are tracking, and when the
		// pick is a movie the whole group leaves the spine below and comes back
		// as a film row -- a film is not a position the episode stepper lands
		// on, whichever way it got here.
		const picked = members.find((m) => preferred?.has(m.id));
		if (picked) return picked;

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

// Feature length but not something AniList calls a MOVIE: these are the only
// entries whose classification is in doubt, so they are the only ones worth a
// TMDB call. A handful per franchise, and the whole graph is cached for a week
// behind them.
//
// This does not depend on the slot layout, which is why it belongs to the graph
// rather than to assembly.
// AniList declares recaps outright: a SUMMARY edge on a part points at the
// entry that condenses it. NOISE_RELATIONS skips those edges for discovery, so
// a recap can never become a part -- but the edge is right there in the payload
// and states what the heuristic can only infer. One Piece Log is a 21-episode
// TV recap, which no runtime rule would ever catch.
//
// A compilation film is a season cut down to two hours, and AniList files it as
// ALTERNATIVE to the run it condenses rather than declaring it a SUMMARY -- so
// the declaration above misses it and no runtime rule catches it either: Attack
// on Titan's first two films carry the show's own manga as their source and no
// PARENT edge at all. What gives them away is the shape of the edge: a film
// alternative to an episodic run that aired alongside it.
//
// It is a substitute for having watched the part, exactly like a declared
// recap, so it leaves the same way -- not a part, not a cut of one, not a film
// row of its own.
//
// Runtime decides which side of the pair is the condensation, and it has to:
// Mugen Train is a real film that was later recut into seven episodes, and it
// wears the same ALTERNATIVE edge. The film is the compilation only when it is
// a fraction of the run it points at.
//
//   AoT: Crimson Bow and Arrow   118 min vs 25x25   0.19  -> compilation
//   Madoka: Beginnings           130 min vs 12x24   0.45  -> compilation
//   Demon Slayer: Mugen Train    117 min vs 7x24    0.70  -> a film, kept
const isCompilation = (nodes, n) => {
	if (n?.format !== "MOVIE") return false;
	const year = n.startDate?.year;
	// no date is no way to tell a condensation from a remake years later
	if (!year) return false;
	const runtime = totalMinutes(n);
	if (!runtime) return false;

	for (const edge of n.relations?.edges ?? []) {
		if (edge.relationType !== "ALTERNATIVE") continue;
		const other = nodes[edge.node?.id];
		const otherYear = other?.startDate?.year;
		if (!other || other.format === "MOVIE" || !otherYear) continue;
		if (Math.abs(year - otherYear) > REMAKE_GAP_YEARS) continue;
		const full = totalMinutes(other);
		// an unmeasurable counterpart is no evidence -- keep the film
		if (full && runtime / full <= RECUT_RUNTIME_RATIO) return true;
	}
	return false;
};

function collectSummarised(nodes) {
	const out = new Set();
	for (const node of Object.values(nodes)) {
		for (const edge of node.relations?.edges ?? []) {
			if (edge.relationType !== "SUMMARY") continue;
			if (edge.node?.type === "ANIME") out.add(edge.node.id);
		}
		if (isCompilation(nodes, node)) out.add(node.id);
	}
	return out;
}

// A recap is not a way to watch a part, it is a substitute for having watched
// one. Only genuine alternative cuts belong on the chain, so these leave
// entirely rather than being filed under the season they condense. The
// declaration wins where it exists; isRecap covers the franchises that make
// none.
const summaryTest = (nodes, summarised, sourceId) => (n) => {
	const id = n?.anilistId ?? n?.id;
	return summarised.has(id) || isRecap(nodes[id] ?? n, sourceId);
};

async function resolvePromotions(nodes, isSummary, franchise) {
	const search = tmdbSearcher();

	const promotable = Object.values(nodes).filter(
		(n) => isFeature(n) && n.format !== "MOVIE" && !isSummary(n),
	);

	const resolved = await Promise.all(
		promotable.map(async (n) => {
			// the entry's own air year, not the show's
			const airedYear = n.startDate?.year;
			try {
				const direct = await tmdbMovieFor(search, label(n), airedYear);
				return [
					n.id,
					direct ??
						(await tmdbFranchiseFilm(search, franchise, airedYear)),
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
	return {
		promotable,
		promoted: new Map(
			[...winners.values()].map((hit) => [hit.anilistId, hit]),
		),
	};
}

// Everything the network can tell us about this franchise. Nothing in here
// depends on which cut the user picked -- picks reorder groups, they do not
// change which entries exist -- so this cache is keyed without them and a cut
// toggle costs no requests at all.
//
// In-process only, like the caches below it.
const GRAPH_TTL = 7 * 24 * 60 * 60 * 1000;
const GRAPH_CACHE_MAX = 300;
const graphCache = new Map();

async function fetchGraph({ nativeTitle, fallbackTitle, year, forceRefresh }) {
	const key = JSON.stringify([
		nativeTitle ?? null,
		fallbackTitle ?? null,
		year ?? null,
	]);
	const hit = graphCache.get(key);
	// handed out by reference: assembly reads these records and builds fresh
	// objects out of them via shape(), never writing back. nodeCache already
	// shares node objects between builds for the same reason.
	if (!forceRefresh && hit && hit.expires > Date.now()) return hit.graph;

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

	await grow(nodes, prints);

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

	const summarised = collectSummarised(nodes);
	const isSummary = summaryTest(nodes, summarised, sourceId);


	// tmdb's english name for the show searches better than the native one;
	// either beats nothing
	const { promotable, promoted } = await resolvePromotions(
		nodes,
		isSummary,
		fallbackTitle ?? nativeTitle,
	);

	const graph = {
		root,
		nodes,
		sourceNode,
		sourceId,
		summarised,
		promotable,
		promoted,
	};
	graphCache.set(key, { graph, expires: Date.now() + GRAPH_TTL });

	if (graphCache.size > GRAPH_CACHE_MAX) {
		const now = Date.now();
		for (const [k, v] of graphCache)
			if (v.expires <= now) graphCache.delete(k);
	}
	return graph;
}

// Pure. Given the graph and the user's picks, lay out the rows.
function assembleChain(graph, preferred) {
	const {
		root,
		nodes,
		sourceNode,
		sourceId,
		summarised,
		promotable,
		promoted,
	} = graph;
	const isSummary = summaryTest(nodes, summarised, sourceId);

	// Only main-format entries can enter the spine. This runs after the batch
	// because isShortForm needs the episode count, which discovery does not
	// carry.
	const isShortForm = (n) => n.format === "ONA" && n.episodes === 1;

	// A recap is not a part and not a way to watch one, so it never enters the
	// grouping: excluded here it can be neither a slot nor a cut offered under
	// one, and films and side stories filter it again below.
	const mainIds = new Set(
		Object.values(nodes)
			.filter(
				(n) =>
					MAIN_FORMATS.includes(n.format) &&
					!isShortForm(n) &&
					!isSummary(n),
			)
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
		preferred,
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

	// A picked cut leaves the spine, and the cuts it was picked over have to
	// travel with it -- otherwise choosing the film strands you there with no
	// way back to the cour.
	const cutsBySlotId = new Map(slots.map((s) => [s.anilistId, s.variants]));

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

	const orphanIds = new Set(orphans.flatMap((g) => groups.get(g)));

	// An entry AniList already calls a MOVIE stays a film whether or not TMDB
	// has caught up: an announced sequel with no listing yet is still a film.
	// Everything else has to earn it.
	const filmNodes = [
		...promotable.filter((n) => promoted.has(n.id)),
		...[...orphanIds]
			.map((id) => nodes[id])
			.filter((n) => n?.format === "MOVIE"),
		...movieSlots,
	].filter((n) => !isSummary(n));
	const filmIds = new Set(filmNodes.map((f) => f.anilistId ?? f.id));
	for (const id of filmIds) orphanIds.delete(id);

	// Which of them the story actually runs through. All three sources above
	// produce films, and only one of them produces continuations: a film that
	// came off the spine walk is an installment -- Mugen Train, Infinity Castle
	// -- while the promoted and orphaned ones were found hanging off a season or
	// a tie-in novel, which is what My Hero Academia's films are. Both stay
	// films here, because being a continuation does not make a film something
	// you track episodes of; the difference is where the chain draws it.
	const spineFilmIds = new Set(movieSlots.map((s) => s.anilistId));

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
				!isSummary(n) &&
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
			// empty for a film that was always a film; populated for one that
			// is a part you chose to watch as a film
			variants: cutsBySlotId.get(film.anilistId) ?? [],
			// the story runs through this one rather than off to the side of it
			isMainline: spineFilmIds.has(film.anilistId),
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
// This layer is keyed with the cuts and saves the assembly work; the graph
// underneath is keyed without them and saves the requests, so switching cuts
// re-lays-out rows that are already in memory.
//
// In-process only. Multiple workers means a cold cache per worker and a restart
// drops everything -- move this, graphCache and anilistClient's query cache to
// Redis if you run more than one instance.
const CHAIN_TTL = 7 * 24 * 60 * 60 * 1000;
const CHAIN_CACHE_MAX = 300;
const chainCache = new Map();

export async function buildAnimeChain({
	nativeTitle,
	fallbackTitle,
	year,
	preferredCuts,
	forceRefresh = false,
}) {
	// sorted: the same picks in a different order are the same chain
	const cuts = [...new Set(preferredCuts ?? [])].sort((a, z) => a - z);
	const key = JSON.stringify([
		nativeTitle ?? null,
		fallbackTitle ?? null,
		year ?? null,
		cuts,
	]);
	const hit = chainCache.get(key);
	if (!forceRefresh && hit && hit.expires > Date.now()) {
		// cloned: callers destructure and reassign, and one of them mutating a
		// shared slot array would corrupt every later read
		return structuredClone(hit.chain);
	}

	const graph = await fetchGraph({
		nativeTitle,
		fallbackTitle,
		year,
		forceRefresh,
	});
	if (!graph) return null;

	// anilist ids the user has picked as the cut they watch for their part
	const chain = assembleChain(graph, new Set(cuts));

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
