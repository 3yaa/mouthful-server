import { fetchSeasonWorks } from "./externalCalls/anilistSeasonAPI.js";
import { getFribbMap } from "./externalCalls/fribbMap.js";
import { animeTitle } from "./utils/shapeAnimes.js";
import { parseTitleNumber } from "./utils/parseParts.js";

const PER_PAGE = 24;
const SERIES = ["TV", "TV_SHORT", "ONA"];
// first month of each
const SEASON_MONTH = { WINTER: 1, SPRING: 4, SUMMER: 7, FALL: 10 };
const WEEK_SEC = 7 * 24 * 60 * 60;
const COUR = 12;
// the countdowns go stale once an episode airs
const LIVE_TTL = 30 * 60 * 1000;
const SETTLED_TTL = 12 * 60 * 60 * 1000;

const SOURCES = {
	ORIGINAL: "Original",
	MANGA: "Manga",
	WEB_MANGA: "Web manga",
	LIGHT_NOVEL: "Light novel",
	WEB_NOVEL: "Web novel",
	NOVEL: "Novel",
	VISUAL_NOVEL: "Visual novel",
	VIDEO_GAME: "Game",
	GAME: "Game",
	COMIC: "Comic",
	PICTURE_BOOK: "Picture book",
	LIVE_ACTION: "Live action",
	MULTIMEDIA_PROJECT: "Multimedia",
};

const fuzzy = (year, month) => year * 10000 + month * 100 + 1;

function seasonBounds(season, year) {
	const month = SEASON_MONTH[season];
	const start = new Date(year, month - 1, 1);
	const end = new Date(year, month + 2, 1);
	return { start, end, startFuzzy: fuzzy(year, month) };
}

function dateOf(date) {
	if (!Number.isInteger(date?.year)) return null;
	const pad = (n) => String(n).padStart(2, "0");
	if (!Number.isInteger(date.month)) return String(date.year);
	if (!Number.isInteger(date.day)) return `${date.year}-${pad(date.month)}`;
	return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

const hasPrequel = (anime) =>
	(anime.relations?.edges ?? []).some(
		(edge) =>
			edge.relationType === "PREQUEL" && edge.node?.type === "ANIME",
	);

// fribb lags a fresh season -- a sequel borrows its prequel's show
function mappedRow(anime, fribb, type) {
	const own = fribb.byAnilist.get(anime.id);
	if (own?.tmdbType === type && own.tmdbId != null) return own;
	if (type !== "tv") return null;
	for (const edge of anime.relations?.edges ?? []) {
		if (edge.relationType !== "PREQUEL" && edge.relationType !== "PARENT")
			continue;
		const row = fribb.byAnilist.get(edge.node?.id);
		if (row?.tmdbType === "tv" && row.tmdbId != null) return row;
	}
	return null;
}

// a leftover still on air when the season opens
function airsInto(anime, startSec) {
	const next = anime.nextAiringEpisode;
	if (!next) return true;
	// no count yet reads as one cour -- unless it is already a long runner
	const last = anime.episodes ?? (next.episode > COUR ? Infinity : COUR);
	return next.airingAt + (last - next.episode) * WEEK_SEC >= startSec;
}

function shapeWork(anime, fribb, isMovie) {
	const row = mappedRow(anime, fribb, isMovie ? "movie" : "tv");
	const { season, part } = parseTitleNumber(
		anime.title?.english ?? anime.title?.romaji,
	);
	return {
		anilistId: anime.id,
		title: animeTitle(anime),
		titleRomaji: anime.title?.romaji ?? null,
		format: anime.format ?? "UNKNOWN",
		status: anime.status ?? null,
		episodes: anime.episodes ?? null,
		duration: anime.duration ?? null,
		posterUrl:
			anime.coverImage?.extraLarge ?? anime.coverImage?.large ?? null,
		posterColor: anime.coverImage?.color ?? null,
		studio: anime.studios?.nodes?.[0]?.name ?? null,
		source: SOURCES[anime.source] ?? null,
		genres: anime.genres ?? [],
		score: anime.averageScore ?? null,
		startDate: dateOf(anime.startDate),
		nextEpisode: anime.nextAiringEpisode
			? {
					episode: anime.nextAiringEpisode.episode,
					airingAt: anime.nextAiringEpisode.airingAt,
				}
			: null,
		sequel: hasPrequel(anime) && (season || part) ? { season, part } : null,
		tmdbId: row ? String(row.tmdbId) : null,
		imdbId: isMovie ? (row?.imdbId ?? null) : null,
	};
}

async function worksFor({ tab, season, year }) {
	const { start, end, startFuzzy } = seasonBounds(season, year);
	const ttl = end < new Date() ? SETTLED_TTL : LIVE_TTL;
	if (tab === "movies") {
		return fetchSeasonWorks(
			{ season, seasonYear: year, formats: ["MOVIE"] },
			ttl,
		);
	}
	if (tab === "new") {
		return fetchSeasonWorks(
			{ season, seasonYear: year, formats: SERIES },
			ttl,
		);
	}
	// ended inside the season, or still going now
	const [ended, airing] = await Promise.all([
		fetchSeasonWorks(
			{ formats: SERIES, startBefore: startFuzzy, endAfter: startFuzzy },
			ttl,
		),
		fetchSeasonWorks(
			{ formats: SERIES, startBefore: startFuzzy, status: "RELEASING" },
			ttl,
		),
	]);
	const startSec = start.getTime() / 1000;
	const ahead = start > new Date();
	const byId = new Map();
	for (const anime of [...ended, ...airing]) {
		if (ahead && !airsInto(anime, startSec)) continue;
		byId.set(anime.id, anime);
	}
	return [...byId.values()].sort(
		(a, z) => (z.popularity ?? 0) - (a.popularity ?? 0),
	);
}

export async function useAnimeDiscoverAPI(req, res) {
	try {
		const { tab, page } = req.validated;
		const [works, fribb] = await Promise.all([
			worksFor(req.validated),
			getFribbMap(),
		]);
		const listed = works.filter((anime) => animeTitle(anime));
		const totalPages = Math.max(1, Math.ceil(listed.length / PER_PAGE));
		const start = (Math.min(page, totalPages) - 1) * PER_PAGE;
		const anime = listed
			.slice(start, start + PER_PAGE)
			.map((work) => shapeWork(work, fribb, tab === "movies"));

		res.status(200).json({ success: true, anime, totalPages });
	} catch (error) {
		console.error("AniList season discover failed: ", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch the season from AniList",
			error: error.message,
		});
	}
}
