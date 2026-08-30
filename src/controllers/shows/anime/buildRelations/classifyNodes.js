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

// make 45 minute feature a film even if its labeled something else
const FEATURE_MINUTES = 45;
const FEATURE_FORMATS = new Set(["SPECIAL", "OVA", "ONA"]);
export const isFeature = (anime) =>
	anime?.format === "MOVIE" ||
	(FEATURE_FORMATS.has(anime?.format) &&
		(anime?.duration ?? 0) >= FEATURE_MINUTES &&
		(anime?.episodes ?? 1) <= 1);

// music video, advert, trailers -- this is a hint
const OFF_STORY_KINDS = new Set(["Клип", "Реклама", "Проморолик"]);
const OFF_STORY_MINUTES = 10;
export function offStory(anime, shikimoriKind) {
	if (anime?.format === "MUSIC") return "music video";
	if (!OFF_STORY_KINDS.has(shikimoriKind)) return null;
	if (anime?.format === "TV" || anime?.format === "MOVIE") return null;
	if ((anime?.duration ?? 0) > OFF_STORY_MINUTES) return null;
	return shikimoriKind === "Реклама" ? "advert" : "promo";
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
	// season and the film cut out of it while it aired
	if ((a.format === "MOVIE") !== (b.format === "MOVIE")) return true;
	//
	const minutesA = measuredMinutes(a);
	const minutesB = measuredMinutes(b);
	if (minutesA == null || minutesB == null) return null;
	const short = Math.min(minutesA, minutesB);
	const long = Math.max(minutesA, minutesB);
	return short / long <= RECUT_RUNTIME_RATIO;
}

//
export function remadeFrom(anime, spine, enrichedNodes) {
	if (!canHoldSpine(anime)) return null;
	let remade = null;
	//
	for (const edge of animeEdges(anime)) {
		if (edge.relationType !== "ALTERNATIVE") continue;
		const otherId = edge.node.id;
		if (!spine.has(otherId)) continue;
		const other = enrichedNodes.get(otherId);
		if (!other || !canHoldSpine(other)) continue;
		// one cut of one production, or no way to tell -- not a remake
		if (sameProduction(anime, other) !== false) return null;
		remade ??= otherId;
	}
	return remade;
}

const PREQUEL_ONLY = new Set(["PREQUEL"]);
const BROADCAST_RELATIONS = new Set(["PREQUEL", "SEQUEL"]);

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

// bootleged detected films are their own nodes -- not detected as real film
export const continuesBroadcast = (anime) =>
	chainsFrom(anime, BROADCAST_RELATIONS);

// detect if real film
export function isFilm(anime, tmdbMovieId) {
	if (anime?.format === "MOVIE") return true;
	if (tmdbMovieId != null) return true;
	return isFeature(anime) && !continuesBroadcast(anime);
}

export function filmTmdbId(anime, byAnilist) {
	const mapped = byAnilist?.get(anime?.anilistId ?? anime?.id);
	return mapped?.tmdbType === "movie" ? (mapped.tmdbId ?? null) : null;
}

// latest node that had already started -- the anchor when no edge names one
export function findDateParent(nodes, target) {
	let parent = null;

	for (const node of nodes) {
		if (!target.startDate || !node.startDate) continue;
		if (node.startDate <= target.startDate) parent = node;
	}

	return parent ?? nodes[0] ?? null;
}

// film only animes stay as slot -- homeless
export function liftFilms(fullFranchise, byAnilist, enrichedNodes) {
	const isMovie = (slot) =>
		isFilm(enrichedNodes.get(slot.anilistId), filmTmdbId(slot, byAnilist));
	const episodic = fullFranchise.filter((slot) => !isMovie(slot));
	if (!episodic.length) return [];
	//
	const films = fullFranchise.filter(isMovie).map((film) => ({
		...film,
		kind: "film",
		isMainLine: true,
		tmdbMovieId: filmTmdbId(film, byAnilist),
	}));
	//
	fullFranchise.length = 0;
	fullFranchise.push(...episodic);
	return films;
}

// attach film to the spine -- release date is fallback
export function hangFilms(films, fullFranchise, enrichedNodes) {
	if (!films.length || !fullFranchise.length) return;
	const slotsById = new Map(
		fullFranchise.map((slot) => [slot.anilistId, slot]),
	);
	// a film's subnode attach to parent film
	const hang = (slot, film, placement) => {
		const { subNodes = [], ...rest } = film;
		slot.subNodes.push({ ...rest, placement });
		slot.subNodes.push(
			...subNodes.map((sub) => ({ ...sub, underFilm: film.anilistId })),
		);
	};

	for (const film of films) {
		const edges = animeEdges(enrichedNodes.get(film.anilistId)).filter(
			(edge) => slotsById.has(edge.node.id),
		);
		const before = edges.find((edge) => edge.relationType === "SEQUEL");
		if (before) {
			hang(slotsById.get(before.node.id), film, "before");
			continue;
		}

		const after = edges.find((edge) => edge.relationType === "PREQUEL");
		if (after) {
			hang(slotsById.get(after.node.id), film, "after");
			continue;
		}

		hang(findDateParent(fullFranchise, film), film, "after");
	}
}
