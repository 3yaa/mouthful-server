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

// if
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

// ALTERNATIVE that are too big to be alternatives
export function isSameProduction(a, b) {
	if (!a || !b) return false;
	const yearA = a.startDate?.year;
	const yearB = b.startDate?.year;
	// no date is no way to tell a recut from a remake -- keep them apart
	if (!yearA || !yearB) return false;
	if (Math.abs(yearA - yearB) > REMAKE_GAP_YEARS) return false;
	// season and the film cut out of it while it aired
	if ((a.format === "MOVIE") !== (b.format === "MOVIE")) return true;
	//
	const minutesA = measuredMinutes(a);
	const minutesB = measuredMinutes(b);
	if (minutesA == null || minutesB == null) return false;
	const short = Math.min(minutesA, minutesB);
	const long = Math.max(minutesA, minutesB);
	return short / long <= RECUT_RUNTIME_RATIO;
}

//
export function remadeFrom(anime, spine, enrichedNodes) {
	if (!canHoldSpine(anime)) return null;
	let remade = null;
	//
	for (const edge of anime?.relations?.edges ?? []) {
		if (edge.relationType !== "ALTERNATIVE") continue;
		const otherId = edge.node?.id;
		if (!spine.has(otherId)) continue;
		const other = enrichedNodes.get(otherId);
		if (!other || !canHoldSpine(other)) continue;
		// one cut of one production
		if (isSameProduction(anime, other)) return null;
		remade ??= otherId;
	}
	return remade;
}

// continues main node chain
export function continuesChain(anime) {
	// remove unaired
	if (!anime?.format) return false;
	const edges = anime.relations?.edges ?? [];
	if (edges.some((edge) => edge.relationType === "PARENT")) return false;
	//
	return edges.some(
		(edge) =>
			edge.relationType === "PREQUEL" && edge.node?.type === "ANIME",
	);
}

// bootleged detected films are their own nodes -- not detected as real film
export const continuesBroadcast = (anime) => {
	const edges = anime?.relations?.edges ?? [];
	if (edges.some((edge) => edge.relationType === "PARENT")) return false;
	//
	return edges.some(
		(edge) =>
			(edge.relationType === "PREQUEL" ||
				edge.relationType === "SEQUEL") &&
			edge.node?.type === "ANIME",
	);
};

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

// film only animes stay as slot -- homeless
export function liftFilms(fullFranchise, byAnilist) {
	const isMovie = (slot) =>
		slot.format === "MOVIE" || filmTmdbId(slot, byAnilist) != null;
	const episodic = fullFranchise.filter((slot) => !isMovie(slot));
	if (!episodic.length) return [];
	//
	const films = fullFranchise
		.filter(isMovie)
		.map(({ position, number, sourceManga, ...film }) => ({
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
	// ova that hung off film hangs off the film's host slot
	const hang = (slot, film, placement) => {
		const { subNodes = [], ...rest } = film;
		slot.subNodes.push({ ...rest, placement });
		slot.subNodes.push(...subNodes);
	};

	for (const film of films) {
		const edges =
			enrichedNodes?.get(film.anilistId)?.relations?.edges ?? [];
		const before = edges.find(
			(edge) =>
				edge.relationType === "SEQUEL" && slotsById.has(edge.node?.id),
		);
		if (before) {
			hang(slotsById.get(before.node.id), film, "before");
			continue;
		}

		const after = edges.find(
			(edge) =>
				edge.relationType === "PREQUEL" && slotsById.has(edge.node?.id),
		);
		if (after) {
			hang(slotsById.get(after.node.id), film, "after");
			continue;
		}

		let parent = fullFranchise[0];
		for (const slot of fullFranchise) {
			if (!slot.startDate || !film.startDate) continue;
			if (slot.startDate <= film.startDate) parent = slot;
		}
		hang(parent, film, "after");
	}
}
