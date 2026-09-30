import { parseTitleNumber } from "../utils/parseParts.js";
import { animeTitle } from "../utils/shapeAnimes.js";

// anime only
export const animeEdges = (anime) =>
	(anime?.relations?.edges ?? []).filter(
		(edge) => edge.node?.type === "ANIME",
	);

// top node
const SPINE_FORMATS = new Set(["TV", "ONA", "MOVIE"]);
const isShortForm = (anime) => anime?.format === "ONA" && anime?.episodes === 1;
export const canHoldSpine = (anime) =>
	SPINE_FORMATS.has(anime?.format) && !isShortForm(anime);

// make 45 minute feature a movie even if its labeled something else
const FEATURE_MINUTES = 45;
const FEATURE_FORMATS = new Set(["SPECIAL", "OVA", "ONA"]);
export const isFeature = (anime) =>
	anime?.format === "MOVIE" ||
	(FEATURE_FORMATS.has(anime?.format) &&
		(anime?.duration ?? 0) >= FEATURE_MINUTES &&
		(anime?.episodes ?? 1) <= 1);

// music video, advert, trailers
const OFF_STORY_KINDS = new Set(["Клип", "Реклама", "Проморолик"]);
const OFF_STORY_MINUTES = 10;
export function isOffStory(anime, shikimoriKind) {
	if (anime?.format === "MUSIC") return true;
	if (!OFF_STORY_KINDS.has(shikimoriKind)) return false;
	if (anime?.format === "TV" || anime?.format === "MOVIE") return false;
	return (anime?.duration ?? 0) <= OFF_STORY_MINUTES;
}

// demote
export function isInterlude(anime, tmdbMovieId) {
	if (anime?.format === "MOVIE" || tmdbMovieId != null) return false;
	if (!isFeature(anime)) return false;
	//
	const { season, part, continuesFinalSeason } = parseTitleNumber(
		animeTitle(anime),
	);
	return season == null && part == null && !continuesFinalSeason;
}

// if a mainnode is too big dont want other main nodes
const OWN_SERIES_EPISODES = 80;
export const runsAsOwnSeries = (anime) =>
	(anime?.episodes ?? 0) > OWN_SERIES_EPISODES;

//
function measuredMinutes(anime) {
	const duration = anime?.duration;
	if (!duration) return null;
	if (anime.episodes == null)
		return anime.format === "MOVIE" ? duration : null;
	return anime.episodes * duration;
}

// drop trash
export const SIDE_STORY_MINUTES = 12;
//
const RECUT_RUNTIME_RATIO = 0.6;
export function isRecapOf(candidate, part) {
	if (candidate?.format === "TV") return false;
	const recap = measuredMinutes(candidate);
	const whole = measuredMinutes(part);
	//
	if (recap == null || whole == null) return false;
	return recap / whole <= RECUT_RUNTIME_RATIO;
}

const REMAKE_GAP_YEARS = 4;

// if too big not ALTERNATIVE
export function sameProduction(a, b) {
	if (!a || !b) return null;
	const yearA = a.startDate?.year;
	const yearB = b.startDate?.year;
	if (!yearA || !yearB) return null;
	if (Math.abs(yearA - yearB) > REMAKE_GAP_YEARS) return false;
	// season and the movie cut out of it while it aired
	if ((a.format === "MOVIE") !== (b.format === "MOVIE")) return true;
	//
	const minutesA = measuredMinutes(a);
	const minutesB = measuredMinutes(b);
	if (minutesA == null || minutesB == null) return null;
	const short = Math.min(minutesA, minutesB);
	const long = Math.max(minutesA, minutesB);
	return short / long <= RECUT_RUNTIME_RATIO;
}

export function isRemake(anime, spine, enrichedNodes) {
	if (!canHoldSpine(anime)) return false;
	const originals = animeEdges(anime)
		.filter(
			(edge) =>
				edge.relationType === "ALTERNATIVE" && spine.has(edge.node.id),
		)
		.map((edge) => enrichedNodes.get(edge.node.id))
		.filter(canHoldSpine);
	return (
		originals.length > 0 &&
		originals.every((other) => sameProduction(anime, other) === false)
	);
}

const PREQUEL_ONLY = new Set(["PREQUEL"]);
export const SPINE_RELATIONS = new Set(["PREQUEL", "SEQUEL"]);

// a node the chain runs through
function chainsFrom(anime, relations) {
	// remove unaired
	if (!anime?.format) return false;
	const edges = animeEdges(anime);
	if (edges.some((edge) => edge.relationType === "PARENT")) return false;
	//
	return edges.some((edge) => relations.has(edge.relationType));
}

// continues main node chain
export const continuesChain = (anime) => chainsFrom(anime, PREQUEL_ONLY);

// bootleged detected movies are their own nodes -- not detected as real movie
const continuesBroadcast = (anime) => chainsFrom(anime, SPINE_RELATIONS);

// stops short to go on the spine
export function isBonusShort(anime, rootAnime) {
	const runtime = anime?.duration ?? 0;
	if (!runtime || runtime >= SIDE_STORY_MINUTES) return false;
	//
	const chainRuntime = rootAnime?.duration ?? 0;
	if (!chainRuntime) return false;
	return runtime / chainRuntime < RECUT_RUNTIME_RATIO;
}

// detect if real movie
export function isMovie(anime, tmdbMovieId) {
	if (anime?.format === "MOVIE") return true;
	if (tmdbMovieId != null) return true;
	return isFeature(anime) && !continuesBroadcast(anime);
}

export function movieTmdbId(anime, byAnilist) {
	const mapped = byAnilist?.get(anime?.anilistId ?? anime?.id);
	return mapped?.tmdbType === "movie" ? (mapped.tmdbId ?? null) : null;
}

export function findDateParent(nodes, target) {
	// no date yet means unannounced
	if (!target.startDate) return nodes.at(-1) ?? null;
	let parent = null;

	for (const node of nodes) {
		if (!node.startDate) continue;
		if (node.startDate <= target.startDate) parent = node;
	}

	return parent ?? nodes[0] ?? null;
}

// movie only animes stay as slot -- homeless
export function liftMovies(fullFranchise, byAnilist, enrichedNodes) {
	const isMovieSlot = (slot) =>
		isMovie(
			enrichedNodes.get(slot.anilistId),
			movieTmdbId(slot, byAnilist),
		);
	const episodic = fullFranchise.filter((slot) => !isMovieSlot(slot));
	if (!episodic.length) return [];
	//
	const movies = fullFranchise.filter(isMovieSlot).map((movie) => ({
		...movie,
		kind: "film",
		isMainLine: true,
		tmdbMovieId: movieTmdbId(movie, byAnilist),
	}));
	//
	fullFranchise.length = 0;
	fullFranchise.push(...episodic);
	return movies;
}

// attach movie to the spine -- through linked movies if need be, release date is fallback
export function hangMovies(movies, fullFranchise, enrichedNodes) {
	if (!movies.length || !fullFranchise.length) return;
	const slotsById = new Map(
		fullFranchise.map((slot) => [slot.anilistId, slot]),
	);
	const moviesById = new Map(movies.map((movie) => [movie.anilistId, movie]));
	const edgesOf = (movie) =>
		animeEdges(enrichedNodes.get(movie.anilistId)).filter((edge) =>
			SPINE_RELATIONS.has(edge.relationType),
		);
	const linkedMovies = (movie) =>
		edgesOf(movie)
			.map((edge) => moviesById.get(edge.node.id))
			.filter(Boolean);
	const slotAnchor = (movie) => {
		const edges = edgesOf(movie).filter((edge) =>
			slotsById.has(edge.node.id),
		);
		// the slot is its sequel, so the movie comes first
		const before = edges.find((edge) => edge.relationType === "SEQUEL");
		if (before) return [slotsById.get(before.node.id), "before"];
		const after = edges.find((edge) => edge.relationType === "PREQUEL");
		if (after) return [slotsById.get(after.node.id), "after"];
		return null;
	};
	// the closest movie that names a slot
	const nearestSlotAnchor = (movie) => {
		const seen = new Set([movie.anilistId]);
		for (let ring = [movie]; ring.length; ) {
			for (const each of ring) {
				const anchor = slotAnchor(each);
				if (anchor) return anchor;
			}
			ring = ring.flatMap(linkedMovies).filter((linked) => {
				if (seen.has(linked.anilistId)) return false;
				seen.add(linked.anilistId);
				return true;
			});
		}
		return null;
	};

	// release order, so a linked movie placed by date is already hung
	const hungAt = new Map();
	for (const movie of movies) {
		const [slot, placement] = nearestSlotAnchor(movie) ??
			linkedMovies(movie)
				.map((linked) => hungAt.get(linked.anilistId))
				.find(Boolean) ?? [
				findDateParent(fullFranchise, movie),
				"after",
			];
		hungAt.set(movie.anilistId, [slot, placement]);
		const { subNodes = [], ...rest } = movie;
		slot.subNodes.push({ ...rest, placement });
		// a movie's own extras ride with it
		slot.subNodes.push(
			...subNodes.map((sub) => ({
				...sub,
				underMovie: movie.anilistId,
				...(sub.kind === "film" ? {} : { placement }),
			})),
		);
	}
}
