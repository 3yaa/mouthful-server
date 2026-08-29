const SOURCE_FORMAT = new Map([
	["MANGA", "MANGA"],
	["COMIC", "MANGA"],
	["DOUJINSHI", "MANGA"],
	["LIGHT_NOVEL", "NOVEL"],
	["NOVEL", "NOVEL"],
	["WEB_NOVEL", "NOVEL"],
]);

export function getMangaAdaptation(anime) {
	const edges = (anime.relations?.edges ?? []).filter(
		(edge) =>
			edge.relationType === "ADAPTATION" && edge.node?.type === "MANGA",
	);
	const wanted = SOURCE_FORMAT.get(anime.source);
	const edge =
		(wanted && edges.find((e) => e.node?.format === wanted)) ?? edges[0];

	if (!edge?.node) return null;

	return {
		anilistId: edge.node.id,
		title:
			edge.node.title?.english ??
			edge.node.title?.romaji ??
			edge.node.title?.native ??
			null,
		format: edge.node.format ?? "MANGA",
	};
}

function getStudio(anime) {
	const edges = anime.studios?.edges ?? [];
	const edge = edges.find((edge) => edge.isMain) ?? edges[0];

	return edge?.node?.name ?? null;
}

function formatStartDate(date) {
	if (!Number.isInteger(date?.year)) return null;

	const parts = [String(date.year)];
	if (Number.isInteger(date.month)) {
		parts.push(String(date.month).padStart(2, "0"));
		if (Number.isInteger(date.day)) {
			parts.push(String(date.day).padStart(2, "0"));
		}
	}

	return parts.join("-");
}

export function shapeAnime(anime, isMainLine) {
	return {
		isMainLine,
		anilistId: anime.id,
		title:
			anime.title?.english ??
			anime.title?.romaji ??
			anime.title?.native ??
			null,
		titleRomaji: anime.title?.romaji ?? null,
		studio: getStudio(anime),
		startDate: formatStartDate(anime.startDate),
		releaseSeason: anime.season,
		releaseYear: anime.seasonYear,
		episode_count: anime.episodes ?? null,
		posterUrl:
			anime.coverImage?.extraLarge ?? anime.coverImage?.large ?? null,
		posterColor: anime.coverImage?.color ?? null,
		isMovie: anime.format === "MOVIE",
		// ova/tv/movie/special...
		format: anime.format ?? "UNKNOWN",
		// ongoing/...
		status: anime.status ?? null,
		duration: anime.duration ?? null,
		countryOfOrigin:
			anime.countryOfOrigin !== "JP" ? anime.countryOfOrigin : undefined,
	};
}

export function shapeAnimeGroup(
	anilistIds,
	enrichedNodes,
	isMainLine,
	missingFromAnilist,
) {
	const shaped = [];
	//
	for (const anilistId of anilistIds) {
		const anime = enrichedNodes.get(anilistId);
		if (!anime) {
			missingFromAnilist.push(anilistId);
			continue;
		}
		const shapedAnime = shapeAnime(anime, isMainLine);
		if (isMainLine) {
			shapedAnime.subNodes = [];
			shapedAnime.variants = [];
		}
		shaped.push(shapedAnime);
	}
	//
	return shaped;
}
