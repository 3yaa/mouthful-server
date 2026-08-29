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
	const episodic = fullFranchise.filter((slot) => !slot.isMovie);
	if (!episodic.length) return [];
	//
	const films = fullFranchise
		.filter((slot) => slot.isMovie)
		.map(({ subNodes, position, number, sourceManga, ...film }) => ({
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

	for (const film of films) {
		const edges =
			enrichedNodes?.get(film.anilistId)?.relations?.edges ?? [];
		const before = edges.find(
			(edge) =>
				edge.relationType === "SEQUEL" && slotsById.has(edge.node?.id),
		);
		if (before) {
			slotsById.get(before.node.id).subNodes.push({
				...film,
				placement: "before",
			});
			continue;
		}

		const after = edges.find(
			(edge) =>
				edge.relationType === "PREQUEL" && slotsById.has(edge.node?.id),
		);
		if (after) {
			slotsById.get(after.node.id).subNodes.push({
				...film,
				placement: "after",
			});
			continue;
		}

		let parent = fullFranchise[0];
		for (const slot of fullFranchise) {
			if (!slot.startDate || !film.startDate) continue;
			if (slot.startDate <= film.startDate) parent = slot;
		}
		parent.subNodes.push({ ...film, placement: "after" });
	}
}
