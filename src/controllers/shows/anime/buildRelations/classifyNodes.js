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

function filmTmdbId(anime, byAnilist) {
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

// attach it to the spine
export function hangFilms(films, fullFranchise) {
	if (!films.length || !fullFranchise.length) return;
	//
	for (const film of films) {
		let parent = fullFranchise[0];
		for (const slot of fullFranchise) {
			if (!slot.startDate || !film.startDate) continue;
			if (slot.startDate <= film.startDate) parent = slot;
		}
		parent.subNodes.push(film);
	}
}
