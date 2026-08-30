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

export const animeTitle = (anime) =>
	anime?.title?.english ??
	anime?.title?.romaji ??
	anime?.title?.native ??
	null;

export function shapeAnime(anime, isMainLine) {
	return {
		isMainLine,
		anilistId: anime.id,
		title: animeTitle(anime),
		titleRomaji: anime.title?.romaji ?? null,
		studio: getStudio(anime),
		startDate: formatStartDate(anime.startDate),
		episode_count: anime.episodes ?? null,
		posterUrl:
			anime.coverImage?.extraLarge ?? anime.coverImage?.large ?? null,
		posterColor: anime.coverImage?.color ?? null,
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

// ─── test entries that leave the chain ────────────────────────────────────

// A row for something the build looked at and did not place: its own AniList
// shape where AniList knew it, and its bare id where it did not. Reason is what
// separates one of these from the next, so it is never defaulted.
export function shapeDropped(anime, anilistId, reason, extra = {}) {
	return {
		...(anime ? shapeAnime(anime, false) : { anilistId, title: null }),
		...extra,
		reason,
	};
}

// Shikimori's own row, for a franchise entry the Fribb list has no AniList id
// for. This is everything knowable about one -- no relations, no runtime, so
// nothing that could place it on a spine -- which is why they can only ever be
// reported. Roughly a third of what shikimori returns for a big franchise lands
// here, and it is not all noise: Attack on Titan's The Last Attack is unmapped.
const SHIKIMORI_FORMAT = new Map([
	["TV Сериал", "TV"],
	["Фильм", "MOVIE"],
	["OVA", "OVA"],
	["ONA", "ONA"],
	["Спецвыпуск", "SPECIAL"],
	["TV Спецвыпуск", "SPECIAL"],
	["Клип", "MUSIC"],
]);

// the placeholder shikimori serves in place of a cover it does not hold
const NO_COVER = "missing";

// shikimori names these in Russian and slugs them in romaji, and the slug is
// the only spelling of the two a reader here can match against the rail
function titleFromSlug(url) {
	const slug =
		String(url ?? "")
			.split("/")
			.pop() ?? "";
	const words = slug.replace(/^\d+-/, "").split("-").filter(Boolean);
	if (!words.length) return null;
	return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

export function shapeUntranslated(node) {
	const image = String(node?.image_url ?? "");
	return {
		anilistId: null,
		malId: Number(node?.id) || null,
		title: titleFromSlug(node?.url) ?? node?.name ?? null,
		format: SHIKIMORI_FORMAT.get(node?.kind) ?? null,
		episode_count: null,
		duration: null,
		startDate: Number.isInteger(node?.year) ? String(node.year) : null,
		studio: null,
		posterUrl: image && !image.includes(NO_COVER) ? image : null,
		posterColor: null,
		shikimoriKind: node?.kind ?? null,
		reason: "unmapped",
	};
}
